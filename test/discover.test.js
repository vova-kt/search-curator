import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discover } from '../src/stages/discover.js';
import { DEFAULTS, mergeConfig } from '../src/core/config.js';
import { memory } from '../src/adapters/storage/memory.js';
import { silentLogger } from './_helpers.js';

const defaultQuery = {
  city: 'Berlin',
  queryText: 'comedy',
  timeframe: { from: '2026-05-01', to: '2026-05-15' },
};

/**
 * @param {{ queryExpansion: import('../src/core/types.js').QueryExpansionStrategy[], search: import('../src/core/types.js').SearchAdapter[] }} opts
 */
function makeCtx({ queryExpansion, search }) {
  return /** @type {any} */ ({
    llm: /** @type {any} */ ({}),
    search,
    storage: memory(),
    strategies: { queryExpansion, dedupe: [], rank: [] },
    config: mergeConfig(DEFAULTS, {}),
    logger: silentLogger,
  });
}

/** @param {string[]} qs */
function expansion(qs) {
  return (_ctx, _query) => ({ queries: qs });
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
  const a = expansion(['Comedy Events in Berlin', 'standup Berlin']);
  const b = expansion(['comedy events in berlin', 'open mic Berlin']);

  const { queries } = await discover(makeCtx({ queryExpansion: [a, b], search: [search] }), defaultQuery);

  assert.deepEqual(seen, ['Comedy Events in Berlin', 'standup Berlin', 'open mic Berlin']);
  assert.deepEqual(queries, ['Comedy Events in Berlin', 'standup Berlin', 'open mic Berlin']);
});

test('discover: throws when queryExpansion is empty (misconfiguration)', async () => {
  await assert.rejects(
    () => discover(makeCtx({ queryExpansion: [], search: [] }), defaultQuery),
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
    'http://example.com/event/42',
    'https://example.com/event/42?id=7',
  ];
  const search = {
    name: 'spy',
    async search() {
      return variants.map((url, i) => ({ url, title: `t${i}`, snippet: '', source: 'spy' }));
    },
  };
  const { hits } = await discover(makeCtx({
    queryExpansion: [expansion(['q'])],
    search: [search],
  }), defaultQuery);

  const urls = hits.map((h) => h.url).sort();
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
  const { hits } = await discover(makeCtx({
    queryExpansion: [expansion(['q'])],
    search: [search],
  }), defaultQuery);

  assert.equal(hits.length, 2);
  assert.equal(hits[0].title, 'first');
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
  const { hits } = await discover(makeCtx({
    queryExpansion: [expansion(['q'])],
    search: [search],
  }), defaultQuery);

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
  const ok = expansion(['working query']);

  await discover(makeCtx({ queryExpansion: [failing, ok], search: [search] }), defaultQuery);

  assert.deepEqual(seen, ['working query']);
});
