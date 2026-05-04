/**
 * Combined LLM filter + rank. One call.
 *
 * Returns events ordered by likely user interest with a short rationale.
 * Events the LLM omits from its response are dropped.
 *
 * Safety net: if the LLM returns an empty or malformed `ranked` array, we
 * fall back to keeping the original list in original order — never collapse
 * results to nothing on a bad response.
 */

import { EventState } from '../../core/eventState.js';
import { rankByPreferencePrompt } from '../../prompts/rankByPreference.js';

/** @type {import('../../core/types.js').Strategy} */
export const llmRank = async (events, ctx, query) => {
  if (events.length <= 1) return { events };
  const { city, queryText, guidance } = query;
  const sq = query.savedQuery;
  const derivedTraits = sq?.derivedTraits;

  const states = await ctx.storage.getEventStates({ city, queryText });
  const liked = states.filter((s) => s.state === EventState.LIKED);
  const disliked = states.filter((s) => s.state === EventState.DISLIKED);

  // Skip the call when there's nothing for the LLM to act on.
  if (liked.length === 0 && disliked.length === 0 && !derivedTraits && !guidance) {
    return { events };
  }

  const candidates = events.map((e) => ({
    id: e.id,
    title: e.title,
    venue: { name: e.venue.name, city: e.venue.city },
    startsAt: e.startsAt,
  }));

  const prompt = rankByPreferencePrompt({
    city,
    queryText,
    candidates,
    liked: liked.map((l) => ({
      title: l.event.title,
      venue: { name: l.event.venue.name, city: l.event.venue.city },
    })),
    disliked: disliked.map((d) => ({
      title: d.event.title,
      venue: { name: d.event.venue.name, city: d.event.venue.city },
      ...(d.reason ? { reason: d.reason } : {}),
    })),
    derivedTraits,
    guidance,
  });

  const resp = await ctx.llm.chat({
    model: ctx.config.llm.model,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    json: true,
    temperature: ctx.config.llm.temperature,
    maxTokens: ctx.config.llm.maxTokens,
    maxRetries: ctx.config.llm.maxRetries,
  });

  const json = /** @type {{ ranked?: Array<{ id: string, rationale?: string }> }} */ (resp.json ?? {});
  const ranked = json.ranked;
  if (!Array.isArray(ranked) || ranked.length === 0) return { events, usage: resp.usage };

  /** @type {Map<string, import('../../core/types.js').Event>} */
  const byId = new Map(events.map((e) => [e.id, e]));
  /** @type {import('../../core/types.js').Event[]} */
  const out = [];
  for (const r of ranked) {
    const e = byId.get(r.id);
    if (!e) continue;
    byId.delete(r.id);
    out.push({ ...e, rationale: r.rationale });
  }
  // Events left in `byId` were omitted by the LLM — they are dropped.
  return { events: out, usage: resp.usage };
};
