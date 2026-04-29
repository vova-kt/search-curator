/**
 * Shared test helpers: stub adapters, sample events.
 */

import { eventId } from '../src/core/identity.js';

/**
 * @param {Partial<import('../src/core/types.js').Event>} overrides
 * @returns {import('../src/core/types.js').Event}
 */
export function makeEvent(overrides = {}) {
  const base = {
    title: 'Sample Event',
    startsAt: '2026-05-02T20:00:00+00:00',
    venue: { name: 'The Venue', city: 'Berlin' },
    source: { name: 'stub', url: 'https://example.com/sample' },
  };
  const merged = { ...base, ...overrides, venue: { ...base.venue, ...(overrides.venue ?? {}) } };
  return {
    ...merged,
    id: overrides.id ?? eventId(merged),
  };
}

/**
 * @param {(req: import('../src/core/types.js').LLMRequest) => unknown | Promise<unknown>} respond
 * @returns {import('../src/core/types.js').LLMAdapter}
 */
export function stubLLM(respond) {
  return {
    name: 'stub',
    model: 'stub',
    async chat(req) {
      const json = await respond(req);
      return { text: typeof json === 'string' ? json : JSON.stringify(json), json };
    },
  };
}

/**
 * @param {import('../src/core/types.js').SearchHit[]} hits
 * @returns {import('../src/core/types.js').SearchAdapter}
 */
export function stubSearch(hits) {
  return {
    name: 'stub',
    async search() {
      return hits;
    },
  };
}
