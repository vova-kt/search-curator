import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '../src/strategies/filter/rules.js';
import { makeEvent } from './_helpers.js';

/**
 * @param {Partial<import('../src/core/types.js').Ctx>} extra
 * @returns {import('../src/core/types.js').Ctx}
 */
function ctx(extra = {}) {
  return /** @type {any} */ ({
    preference: { liked: [], disliked: [], explicitFilters: {} },
    query: { city: 'Berlin', queryText: 'comedy', timeframe: { from: '2026-05-01', to: '2026-05-31' } },
    config: { dedupe: { fuzzyTitleThreshold: 0.85 } },
    ...extra,
  });
}

test('rules: excludeKeywords drops matching events', async () => {
  const events = [
    makeEvent({ title: 'Open Mic at Pub' }),
    makeEvent({ title: 'Pro Comedy Show', source: { name: 's', url: 'https://b.example.com' } }),
  ];
  const out = await rules(events, ctx({ preference: { liked: [], disliked: [], explicitFilters: { excludeKeywords: ['open mic'] } } }));
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Pro Comedy Show');
});

test('rules: excludeKeywords matches Russian morphological variants', async () => {
  const events = [
    makeEvent({ title: 'Большой концерт' }),
    makeEvent({ title: 'Концерты под открытым небом', source: { name: 's', url: 'https://b.example.com' } }),
    makeEvent({ title: 'На концерте было шумно', source: { name: 's', url: 'https://c.example.com' } }),
    makeEvent({ title: 'Театральная постановка', source: { name: 's', url: 'https://d.example.com' } }),
  ];
  const out = await rules(events, ctx({ preference: { liked: [], disliked: [], explicitFilters: { excludeKeywords: ['концерт'] } } }));
  assert.deepEqual(out.map((e) => e.title), ['Театральная постановка']);
});

test('rules: excludeKeywords matches English plural via stemming', async () => {
  const events = [
    makeEvent({ title: 'Comedy Show' }),
    makeEvent({ title: 'Stand-up Shows tonight', source: { name: 's', url: 'https://b.example.com' } }),
    makeEvent({ title: 'Quiet reading', source: { name: 's', url: 'https://c.example.com' } }),
  ];
  const out = await rules(events, ctx({ preference: { liked: [], disliked: [], explicitFilters: { excludeKeywords: ['show'] } } }));
  assert.deepEqual(out.map((e) => e.title), ['Quiet reading']);
});

test('rules: query filters override preference filters', async () => {
  const events = [
    makeEvent({ title: 'Cheap show', price: { currency: 'EUR', min: 5 }, source: { name: 's', url: 'https://a.example.com' } }),
    makeEvent({ title: 'Pricey show', price: { currency: 'EUR', min: 50 }, source: { name: 's', url: 'https://b.example.com' } }),
  ];
  const out = await rules(events, ctx({
    preference: { liked: [], disliked: [], explicitFilters: { price: { max: 100 } } },
    query: { city: 'Berlin', queryText: 'comedy', timeframe: { from: '2026-05-01', to: '2026-05-31' }, filters: { price: { max: 10 } } },
  }));
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Cheap show');
});

