/**
 * Chronological ranking — soonest first. Always safe as a fallback.
 */

/** @type {import('../../core/types.js').Strategy} */
export const byDate = (events, _ctx, _query) => {
  return { events: [...events].sort((a, b) => a.startsAt.localeCompare(b.startsAt)) };
};
