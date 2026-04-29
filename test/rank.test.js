import { test } from 'node:test';
import assert from 'node:assert/strict';
import { llmRank } from '../src/strategies/rank/llmRank.js';
import { memory } from '../src/adapters/storage/memory.js';
import { EventState } from '../src/core/eventState.js';
import { makeEvent, stubLLM } from './_helpers.js';

/**
 * @param {Partial<import('../src/core/types.js').Ctx> & { storage?: import('../src/core/types.js').StorageAdapter }} extra
 * @returns {import('../src/core/types.js').Ctx}
 */
function ctx(extra = {}) {
  return /** @type {any} */ ({
    query: { city: 'Berlin', queryText: 'comedy', timeframe: { from: '2026-05-01', to: '2026-05-31' } },
    config: {},
    storage: extra.storage ?? memory(),
    ...extra,
  });
}

async function freshStorage() {
  const s = memory();
  await s.init();
  return s;
}

test('llmRank: skips the LLM when there is no preference signal and no guidance', async () => {
  let called = 0;
  const llm = stubLLM(() => { called++; return { ranked: [] }; });
  const a = makeEvent({ title: 'A' });
  const b = makeEvent({ title: 'B', source: { name: 's', url: 'https://b.example.com' } });
  const storage = await freshStorage();
  const out = await llmRank([a, b], ctx({ llm, storage }));
  assert.equal(called, 0);
  assert.deepEqual(out.map((e) => e.id), [a.id, b.id]);
});

test('llmRank: guidance alone triggers the LLM and drops omitted events', async () => {
  const a = makeEvent({ title: 'A' });
  const b = makeEvent({ title: 'B', source: { name: 's', url: 'https://b.example.com' } });
  const c = makeEvent({ title: 'C', source: { name: 's', url: 'https://c.example.com' } });
  let captured;
  const llm = stubLLM((req) => {
    captured = req;
    return {
      ranked: [
        { id: c.id, rationale: 'fits guidance well today' },
        { id: a.id, rationale: 'second best for guidance' },
      ],
    };
  });
  const storage = await freshStorage();
  const out = await llmRank([a, b, c], ctx({ llm, storage, query: {
    city: 'Berlin', queryText: 'comedy', timeframe: { from: '2026-05-01', to: '2026-05-31' },
    guidance: 'prefer intimate venues',
  } }));
  assert.deepEqual(out.map((e) => e.id), [c.id, a.id]);
  assert.equal(out[0].rationale, 'fits guidance well today');
  assert.match(captured.messages[0].content, /<guidance>prefer intimate venues<\/guidance>/);
});

test('llmRank: liked junction rows trigger the LLM with a populated liked list', async () => {
  const a = makeEvent({ title: 'A' });
  const b = makeEvent({ title: 'B', source: { name: 's', url: 'https://b.example.com' } });
  const liked = makeEvent({ title: 'Past Liked', source: { name: 's', url: 'https://past.example.com' } });
  const storage = await freshStorage();
  await storage.upsertEvents([liked]);
  await storage.recordEventStates(
    [{ eventId: liked.id, state: EventState.LIKED }],
    { city: 'Berlin', queryText: 'comedy' },
  );
  let captured;
  const llm = stubLLM((req) => {
    captured = req;
    return { ranked: [{ id: a.id, rationale: 'matches taste' }] };
  });
  const out = await llmRank([a, b], ctx({ llm, storage }));
  assert.deepEqual(out.map((e) => e.id), [a.id]);
  assert.match(captured.messages[0].content, /Past Liked/);
});

test('llmRank: empty/invalid response falls back to all events in original order', async () => {
  const a = makeEvent({ title: 'A' });
  const b = makeEvent({ title: 'B', source: { name: 's', url: 'https://b.example.com' } });
  const llm = stubLLM(() => ({ ranked: [] }));
  const storage = await freshStorage();
  const out = await llmRank([a, b], ctx({
    llm,
    storage,
    query: { city: 'Berlin', queryText: 'comedy', timeframe: { from: '2026-05-01', to: '2026-05-31' }, guidance: 'x' },
  }));
  assert.deepEqual(out.map((e) => e.id), [a.id, b.id]);
});
