/**
 * Feedback stage: turn one user-state transition into a junction-row update.
 * Invoked from the public API, not the curate() pipeline.
 * See docs/pipeline.md and docs/preferences.md.
 */

import { EventState } from '../core/eventState.js';
import { derivePreferenceTraitsPrompt } from '../prompts/derivePreferenceTraits.js';

/**
 * @param {import('../core/types.js').FeedbackInput & { ref: import('../core/types.js').SavedQueryRef }} input
 *   `state` is the new state for every id in the call. `reasons` maps event id → free-text user note;
 *   only consulted when `state === 'disliked'`. Empty/whitespace strings are dropped so no empty
 *   reason ever lands in storage.
 * @param {import('../core/types.js').Ctx} ctx
 */
export async function recordFeedback(input, ctx) {
  if (input.ids.length === 0) return;

  /** @type {import('../core/types.js').EventStateItem[]} */
  const items = input.ids.map((id) => {
    const reason = input.state === EventState.DISLIKED ? input.reasons?.[id]?.trim() : undefined;
    /** @type {import('../core/types.js').EventStateItem} */
    const item = { eventId: id, state: input.state };
    if (reason) item.reason = reason;
    return item;
  });

  await ctx.storage.recordEventStates(items, input.ref);

  // Derived-traits refresh is only relevant for like/dislike signal.
  if (input.state !== EventState.LIKED && input.state !== EventState.DISLIKED) return;
  if (!ctx.config.preferences.deriveTraits) return;

  const sq = await ctx.storage.getSavedQuery(input.ref);
  if (!sq) return;

  const states = await ctx.storage.getEventStates(input.ref);
  const liked = states.filter((s) => s.state === EventState.LIKED);
  const disliked = states.filter((s) => s.state === EventState.DISLIKED);
  const total = liked.length + disliked.length;
  if (total < ctx.config.preferences.traitsRefreshThreshold) return;

  const traits = await deriveTraits(sq, liked, disliked, ctx);
  if (!traits) return;

  await ctx.storage.upsertSavedQuery({ ...sq, derivedTraits: traits });
}

/**
 * @param {import('../core/types.js').SavedQuery} sq
 * @param {import('../core/types.js').EventStateRecord[]} liked
 * @param {import('../core/types.js').EventStateRecord[]} disliked
 * @param {import('../core/types.js').Ctx} ctx
 * @returns {Promise<string | undefined>}
 */
async function deriveTraits(sq, liked, disliked, ctx) {
  const prompt = derivePreferenceTraitsPrompt({
    queryText: sq.queryText,
    ...(sq.guidance ? { guidance: sq.guidance } : {}),
    liked: liked.map((l) => ({
      title: l.event.title,
      venue: { name: l.event.venue.name, city: l.event.venue.city },
      startsAt: l.event.startsAt,
    })),
    disliked: disliked.map((d) => ({
      title: d.event.title,
      venue: { name: d.event.venue.name, city: d.event.venue.city },
      startsAt: d.event.startsAt,
      ...(d.reason ? { reason: d.reason } : {}),
    })),
  });
  const resp = await ctx.llm.chat({
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    json: true,
  });
  const json = /** @type {{ traits?: string }} */ (resp.json ?? {});
  return typeof json.traits === 'string' ? json.traits : undefined;
}
