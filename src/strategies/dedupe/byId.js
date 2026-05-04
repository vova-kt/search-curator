/**
 * Dedupe by canonical event id (content-derived hash of title/startsAt/venue/city).
 * Catches the same event extracted from multiple source pages, without collapsing
 * distinct events listed on the same page.
 */

/** @type {import('../../core/types.js').Strategy} */
export const byId = (events, _ctx, _query) => {
  /** @type {Map<string, import('../../core/types.js').Event>} */
  const seen = new Map();
  for (const e of events) {
    if (!seen.has(e.id)) seen.set(e.id, e);
  }
  return { events: [...seen.values()] };
};
