import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discover } from '../src/stages/discover.js';
import { DEFAULTS, mergeConfig } from '../src/core/config.js';
import { memory } from '../src/adapters/storage/memory.js';

/**
 * Build a minimal Ctx for the discover stage.
 * @param {{ queryExpansion: import('../src/core/types.js').QueryExpansionStrategy[], search: import('../src/core/types.js').SearchAdapter[] }} opts
 */
function makeCtx({ queryExpansion, search }) {
  return /** @type {any} */ ({
    llm: /** @type {any} */ ({}),
    search,
    storage: memory(),
    strategies: { queryExpansion, dedupe: [], filter: [], rank: [] },
    config: mergeConfig(DEFAULTS, {}),
    query: {
      city: 'Berlin',
      category: 'comedy',
      timeframe: { from: '2026-05-01', to: '2026-05-15' },
    },
    preference: { liked: [], disliked: [], explicitFilters: {} },
  });
}

test('discover: dedupes queries from multiple strategies before fan-out', async () => {
  /** @type {string[]} */
  const seen = [];
  const search = {
    name: 'spy',
    async search(q) {
      seen.push(q);
      return [];
    },
  };
  const a = () => ['Comedy Events in Berlin', 'standup Berlin'];
  const b = () => ['comedy events in berlin', 'open mic Berlin']; // first overlaps with a (case-insensitive)

  await discover(makeCtx({ queryExpansion: [a, b], search: [search] }));

  // Three distinct queries (case-insensitive), in insertion order, first-seen casing wins.
  assert.deepEqual(seen, ['Comedy Events in Berlin', 'standup Berlin', 'open mic Berlin']);
});

test('discover: throws when queryExpansion is empty (misconfiguration)', async () => {
  await assert.rejects(
    () => discover(makeCtx({ queryExpansion: [], search: [] })),
    /no queryExpansion strategies/,
  );
});

test('discover: a failing expansion strategy is skipped, others continue', async () => {
  /** @type {string[]} */
  const seen = [];
  const search = {
    name: 'spy',
    async search(q) {
      seen.push(q);
      return [];
    },
  };
  const failing = () => { throw new Error('strategy failed'); };
  const ok = () => ['working query'];

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    await discover(makeCtx({ queryExpansion: [failing, ok], search: [search] }));
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(seen, ['working query']);
});
