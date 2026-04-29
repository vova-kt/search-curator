import { test } from 'node:test';
import assert from 'node:assert/strict';
import { llmRank } from '../src/strategies/rank/llmRank.js';
import { makeEvent, stubLLM } from './_helpers.js';

/**
 * @param {Partial<import('../src/core/types.js').Ctx>} extra
 * @returns {import('../src/core/types.js').Ctx}
 */
function ctx(extra = {}) {
  return /** @type {any} */ ({
    preference: { liked: [], disliked: [], explicitFilters: {} },
    query: { city: 'Berlin', category: 'comedy', timeframe: { from: '2026-05-01', to: '2026-05-31' } },
    config: {},
    ...extra,
  });
}

test('llmRank: skips the LLM when there is no preference signal and no guidance', async () => {
  let called = 0;
  const llm = stubLLM(() => { called++; return { ranked: [] }; });
  const a = makeEvent({ title: 'A' });
  const b = makeEvent({ title: 'B', source: { name: 's', url: 'https://b.example.com' } });
  const out = await llmRank([a, b], ctx({ llm }));
  assert.equal(called, 0);
  assert.deepEqual(out.map((e) => e.id), [a.id, b.id]);
});

test('llmRank: rankGuidance alone triggers the LLM and drops omitted events', async () => {
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
  const out = await llmRank([a, b, c], ctx({ llm, query: {
    city: 'Berlin', category: 'comedy', timeframe: { from: '2026-05-01', to: '2026-05-31' },
    rankGuidance: 'prefer intimate venues',
  } }));
  assert.deepEqual(out.map((e) => e.id), [c.id, a.id]);
  assert.equal(out[0].rationale, 'fits guidance well today');
  assert.match(captured.messages[0].content, /User guidance: prefer intimate venues/);
});

test('llmRank: empty/invalid response falls back to all events in original order', async () => {
  const a = makeEvent({ title: 'A' });
  const b = makeEvent({ title: 'B', source: { name: 's', url: 'https://b.example.com' } });
  const llm = stubLLM(() => ({ ranked: [] }));
  const out = await llmRank([a, b], ctx({
    llm,
    query: { city: 'Berlin', category: 'comedy', timeframe: { from: '2026-05-01', to: '2026-05-31' }, rankGuidance: 'x' },
  }));
  assert.deepEqual(out.map((e) => e.id), [a.id, b.id]);
});
