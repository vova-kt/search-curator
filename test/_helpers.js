/**
 * Shared test helpers: stub adapters, sample events.
 */

import { eventId } from '../src/core/identity.js';
import { createLogger } from '../src/core/logger.js';

/** Silent logger for tests that build their own ctx. */
export const silentLogger = createLogger('silent');

/**
 * ISO datetime 7 days from now — keeps fixtures inside rolling windows.
 * @returns {string}
 */
export function futureDate() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 7);
  d.setUTCHours(20, 0, 0, 0);
  return d.toISOString().replace('.000Z', '+00:00');
}

/**
 * @param {Partial<import('../src/core/types.js').Event>} overrides
 * @returns {import('../src/core/types.js').Event}
 */
export function makeEvent(overrides = {}) {
  const base = {
    title: 'Sample Event',
    startsAt: futureDate(),
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
    async chat(req) {
      const json = await respond(req);
      return { text: typeof json === 'string' ? json : JSON.stringify(json), json, usage: { inputTokens: 0, outputTokens: 0 } };
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
