import { test } from 'node:test';
import assert from 'node:assert/strict';
import { templates, llmExpand } from '../src/strategies/queryExpansion/index.js';
import { memory } from '../src/adapters/storage/memory.js';
import { stubLLM, silentLogger } from './_helpers.js';
import { DEFAULTS, mergeConfig } from '../src/core/config.js';

const defaultQuery = {
  city: 'Berlin',
  queryText: 'comedy',
  timeframe: { from: '2026-05-01', to: '2026-05-15' },
};

/**
 * @param {{ llm: import('../src/core/types.js').LLMAdapter, storage: import('../src/core/types.js').StorageAdapter, config?: Partial<import('../src/core/types.js').Config> }} opts
 * @returns {import('../src/core/types.js').Ctx}
 */
function makeCtx({ llm, storage, config }) {
  return /** @type {any} */ ({
    llm,
    storage,
    search: [],
    strategies: { queryExpansion: [], dedupe: [], rank: [] },
    config: mergeConfig(DEFAULTS, config),
    logger: silentLogger,
  });
}

test('templates: returns four deterministic phrasings of (city, queryText)', async () => {
  const ctx = makeCtx({ llm: stubLLM(() => ({})), storage: memory() });
  const { queries: out } = await templates()(ctx, defaultQuery);
  assert.equal(out.length, 4);
  assert.ok(out.every((q) => q.includes('Berlin')));
  assert.ok(out.every((q) => q.includes('comedy')));
});

test('llmExpand: caps result to limit and persists to KV', async () => {
  let llmCalls = 0;
  const llm = stubLLM(() => {
    llmCalls++;
    return {
      queries: [
        'comedy events in Berlin',
        'standup Berlin May 2026',
        'Comedy Berlin Mai 2026',
        'open mic Berlin',
        'comedy clubs Berlin this weekend',
        'live comedy Berlin',
      ],
    };
  });
  const storage = memory();
  await storage.init();
  const ctx = makeCtx({ llm, storage, config: { queryExpansion: { maxQueries: 3 } } });

  const { queries: out } = await llmExpand()(ctx, defaultQuery);
  assert.equal(out.length, 3);
  assert.equal(llmCalls, 1);

  // Cache hit: same key, no second LLM call.
  const { queries: out2 } = await llmExpand()(ctx, defaultQuery);
  assert.deepEqual(out2, out);
  assert.equal(llmCalls, 1);
});

test('llmExpand: cache key changes with timeframe', async () => {
  let llmCalls = 0;
  const llm = stubLLM(() => {
    llmCalls++;
    return { queries: ['q1', 'q2'] };
  });
  const storage = memory();
  await storage.init();
  const ctx = makeCtx({ llm, storage });

  const queryMay = { ...defaultQuery, timeframe: { from: '2026-05-01', to: '2026-05-15' } };
  const queryJune = { ...defaultQuery, timeframe: { from: '2026-06-01', to: '2026-06-15' } };

  await llmExpand()(ctx, queryMay);
  await llmExpand()(ctx, queryJune);
  assert.equal(llmCalls, 2);
});

test('llmExpand: in dev mode rethrows on LLM failure', async () => {
  const llm = stubLLM(() => {
    throw new Error('boom');
  });
  const storage = memory();
  await storage.init();
  const ctx = makeCtx({ llm, storage, config: { dev: true } });

  await assert.rejects(() => Promise.resolve(llmExpand()(ctx, defaultQuery)), /boom/);
});

test('llmExpand: in prod mode falls back to templates and warns', async () => {
  const llm = stubLLM(() => {
    throw new Error('boom');
  });
  const storage = memory();
  await storage.init();
  const ctx = makeCtx({ llm, storage });
  let warned = false;
  ctx.logger = { error: () => {}, warn: () => { warned = true; }, info: () => {}, debug: () => {} };

  const { queries: out } = await llmExpand()(ctx, defaultQuery);
  assert.equal(out.length, 4); // templates produces 4
  assert.ok(out.every((q) => q.includes('Berlin')));
  assert.ok(warned);
});

test('llmExpand: malformed LLM response (no queries field) treated as failure', async () => {
  const llm = stubLLM(() => ({ events: [] })); // wrong shape
  const storage = memory();
  await storage.init();
  const ctx = makeCtx({ llm, storage, config: { dev: true } });

  await assert.rejects(() => Promise.resolve(llmExpand()(ctx, defaultQuery)), /no usable queries/);
});

test('llmExpand: defaultLimit comes from config when not overridden', async () => {
  const queries = Array.from({ length: 20 }, (_, i) => `query ${i}`);
  const llm = stubLLM(() => ({ queries }));
  const storage = memory();
  await storage.init();
  const ctx = makeCtx({ llm, storage, config: { queryExpansion: { maxQueries: 5 } } });

  const { queries: out } = await llmExpand()(ctx, defaultQuery);
  assert.equal(out.length, 5);
});
