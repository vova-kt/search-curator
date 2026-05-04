import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rules } from '../src/strategies/rank/rules.js';
import { makeEvent } from './_helpers.js';

const emptyCtx = /** @type {any} */ ({});

/**
 * @param {Partial<import('../src/core/types.js').SavedQuery>} [sq]
 * @returns {import('../src/core/types.js').Query}
 */
function query(sq) {
  return /** @type {any} */ ({
    city: 'Berlin',
    queryText: 'comedy',
    timeframe: { from: '2026-05-01', to: '2026-05-31' },
    savedQuery: sq
      ? {
          city: 'Berlin', queryText: 'comedy', days: 14, limit: 10,
          excludeKeywords: [], createdAt: '2026-04-01T00:00:00Z',
          ...sq,
        }
      : undefined,
  });
}

test('rules: no savedQuery means no filtering', async () => {
  const events = [makeEvent({ title: 'Anything' })];
  const { events: out } = await rules(events, emptyCtx, query());
  assert.equal(out.length, 1);
});

test('rules: excludeKeywords drops matching events', async () => {
  const events = [
    makeEvent({ title: 'Open Mic at Pub' }),
    makeEvent({ title: 'Pro Comedy Show', source: { name: 's', url: 'https://b.example.com' } }),
  ];
  const { events: out } = await rules(events, emptyCtx, query({ excludeKeywords: ['open mic'] }));
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
  const { events: out } = await rules(events, emptyCtx, query({ excludeKeywords: ['концерт'] }));
  assert.deepEqual(out.map((e) => e.title), ['Театральная постановка']);
});

test('rules: excludeKeywords matches English plural via stemming', async () => {
  const events = [
    makeEvent({ title: 'Comedy Show' }),
    makeEvent({ title: 'Stand-up Shows tonight', source: { name: 's', url: 'https://b.example.com' } }),
    makeEvent({ title: 'Quiet reading', source: { name: 's', url: 'https://c.example.com' } }),
  ];
  const { events: out } = await rules(events, emptyCtx, query({ excludeKeywords: ['show'] }));
  assert.deepEqual(out.map((e) => e.title), ['Quiet reading']);
});

test('rules: price max from savedQuery filters out pricey events', async () => {
  const events = [
    makeEvent({ title: 'Cheap show', price: { currency: 'EUR', min: 5 }, source: { name: 's', url: 'https://a.example.com' } }),
    makeEvent({ title: 'Pricey show', price: { currency: 'EUR', min: 50 }, source: { name: 's', url: 'https://b.example.com' } }),
  ];
  const { events: out } = await rules(events, emptyCtx, query({ price: { max: 10 } }));
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Cheap show');
});

test('rules: excludeVenues from savedQuery drops matching venues', async () => {
  const events = [
    makeEvent({ title: 'A', venue: { name: 'Big Hall', city: 'Berlin' } }),
    makeEvent({ title: 'B', venue: { name: 'Tiny Bar', city: 'Berlin' }, source: { name: 's', url: 'https://b.example.com' } }),
  ];
  const { events: out } = await rules(events, emptyCtx, query({ excludeVenues: ['Big Hall'] }));
  assert.deepEqual(out.map((e) => e.title), ['B']);
});

test('rules: freeOnly drops paid events', async () => {
  const events = [
    makeEvent({ title: 'Free', price: { free: true } }),
    makeEvent({ title: 'Paid', price: { currency: 'EUR', min: 10 }, source: { name: 's', url: 'https://b.example.com' } }),
  ];
  const { events: out } = await rules(events, emptyCtx, query({ freeOnly: true }));
  assert.deepEqual(out.map((e) => e.title), ['Free']);
});
