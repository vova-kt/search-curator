/**
 * Feedback stage: turn user picks into preference updates.
 * Invoked from the public API, not the curate() pipeline.
 * See docs/pipeline.md and docs/preferences.md.
 */

import { derivePreferenceTraitsPrompt } from '../prompts/derivePreferenceTraits.js';

/**
 * @param {{ liked: string[], disliked: string[] }} picks
 * @param {import('../core/types.js').Event[]} candidates  // last result set
 * @param {import('../core/types.js').Ctx} ctx
 */
export async function recordFeedback(picks, candidates, ctx) {
  /** @type {Map<string, import('../core/types.js').Event>} */
  const byId = new Map(candidates.map((e) => [e.id, e]));

  // Resolve any ids that aren't in `candidates` from storage.
  const missing = [...picks.liked, ...picks.disliked].filter((id) => !byId.has(id));
  if (missing.length > 0) {
    const found = await ctx.storage.getEvents(missing);
    for (const e of found) byId.set(e.id, e);
  }

  /**
   * @param {import('../core/types.js').Event} e
   * @returns {import('../core/types.js').EventRef}
   */
  const toRef = (e) => ({
    id: e.id,
    title: e.title,
    venue: { name: e.venue.name, city: e.venue.city },
    startsAt: e.startsAt,
    subcategories: e.subcategories,
  });

  /** @param {import('../core/types.js').Event | undefined} e */
  const isEvent = (e) => Boolean(e);
  const likedRefs = picks.liked
    .map((id) => byId.get(id))
    .filter(/** @returns {e is import('../core/types.js').Event} */ (e) => isEvent(e))
    .map(toRef);
  const dislikedRefs = picks.disliked
    .map((id) => byId.get(id))
    .filter(/** @returns {e is import('../core/types.js').Event} */ (e) => isEvent(e))
    .map(toRef);

  const scope = scopeFromQuery(ctx.query);
  const updated = await ctx.storage.updatePreference((current) => {
    return {
      ...current,
      liked: mergeRefs(current.liked, likedRefs),
      disliked: mergeRefs(current.disliked, dislikedRefs),
    };
  }, scope);

  // Optionally re-derive traits.
  const totalNew = likedRefs.length + dislikedRefs.length;
  if (
    ctx.config.preferences.deriveTraits &&
    totalNew > 0 &&
    (updated.liked.length + updated.disliked.length) >= ctx.config.preferences.traitsRefreshThreshold
  ) {
    const traits = await deriveTraits(updated, ctx);
    if (traits) {
      await ctx.storage.updatePreference((current) => ({ ...current, derivedTraits: traits }), scope);
    }
  }
}

/**
 * @param {import('../core/types.js').EventRef[]} a
 * @param {import('../core/types.js').EventRef[]} b
 */
function mergeRefs(a, b) {
  /** @type {Map<string, import('../core/types.js').EventRef>} */
  const m = new Map();
  for (const r of a) m.set(r.id, r);
  for (const r of b) m.set(r.id, r);
  return [...m.values()];
}

/**
 * @param {import('../core/types.js').Query} q
 * @returns {import('../core/types.js').PreferenceScope}
 */
function scopeFromQuery(q) {
  return { city: q.city, queryText: q.queryText };
}

/**
 * @param {import('../core/types.js').Preference} pref
 * @param {import('../core/types.js').Ctx} ctx
 * @returns {Promise<string | undefined>}
 */
async function deriveTraits(pref, ctx) {
  const prompt = derivePreferenceTraitsPrompt({
    liked: pref.liked.map((l) => ({ title: l.title, venue: l.venue, startsAt: l.startsAt, subcategories: l.subcategories })),
    disliked: pref.disliked.map((d) => ({ title: d.title, venue: d.venue, startsAt: d.startsAt, subcategories: d.subcategories })),
  });
  const resp = await ctx.llm.chat({
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    json: true,
  });
  const json = /** @type {{ traits?: string }} */ (resp.json ?? {});
  return typeof json.traits === 'string' ? json.traits : undefined;
}
