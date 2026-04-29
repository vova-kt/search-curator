import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discover } from '../src/stages/discover.js';
import { DEFAULTS, mergeConfig } from '../src/core/config.js';
import { memory } from '../src/adapters/storage/memory.js';
import { silentLogger } from './_helpers.js';

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
      queryText: 'comedy',
      timeframe: { from: '2026-05-01', to: '2026-05-15' },
    },
    logger: silentLogger,
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

test('discover: collapses hits whose URLs differ only by tracking params, www, casing, fragment, or trailing slash', async () => {
  const variants = [
    'https://example.com/event/42',
    'https://www.example.com/event/42',
    'https://EXAMPLE.com/event/42/',
    'https://example.com/event/42#tickets',
    'https://example.com/event/42?utm_source=newsletter&utm_campaign=spring',
    'https://example.com/event/42?fbclid=abc&gclid=xyz&ref=twitter',
    'http://example.com/event/42', // distinct (different scheme)
    'https://example.com/event/42?id=7', // distinct (non-tracking param)
  ];
  const search = {
    name: 'spy',
    async search() {
      return variants.map((url, i) => ({ url, title: `t${i}`, snippet: '', source: 'spy' }));
    },
  };
  const hits = await discover(makeCtx({
    queryExpansion: [() => ['q']],
    search: [search],
  }));

  const urls = hits.map((h) => h.url).sort();
  // First-seen wins for the canonical group; the other two stand alone.
  assert.deepEqual(urls, [
    'http://example.com/event/42',
    'https://example.com/event/42',
    'https://example.com/event/42?id=7',
  ]);
});

test('discover: preserves non-tracking query params and keeps the first-seen variant', async () => {
  const search = {
    name: 'spy',
    async search() {
      return [
        { url: 'https://example.com/e?id=1&utm_medium=email', title: 'first', snippet: '', source: 'spy' },
        { url: 'https://example.com/e?id=1', title: 'second', snippet: '', source: 'spy' },
        { url: 'https://example.com/e?id=2', title: 'third', snippet: '', source: 'spy' },
      ];
    },
  };
  const hits = await discover(makeCtx({
    queryExpansion: [() => ['q']],
    search: [search],
  }));

  assert.equal(hits.length, 2);
  assert.equal(hits[0].title, 'first'); // first-seen variant wins for the canonical group
  assert.equal(hits[1].title, 'third');
});

test('discover: unparseable URLs fall back to exact-match dedup', async () => {
  const search = {
    name: 'spy',
    async search() {
      return [
        { url: 'not a url', title: 'a', snippet: '', source: 'spy' },
        { url: 'not a url', title: 'b', snippet: '', source: 'spy' },
        { url: 'also not a url', title: 'c', snippet: '', source: 'spy' },
      ];
    },
  };
  const hits = await discover(makeCtx({
    queryExpansion: [() => ['q']],
    search: [search],
  }));

  assert.deepEqual(hits.map((h) => h.title).sort(), ['a', 'c']);
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

  await discover(makeCtx({ queryExpansion: [failing, ok], search: [search] }));

  assert.deepEqual(seen, ['working query']);
});
