import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byId } from '../src/strategies/dedupe/byId.js';
import { fuzzyTitle } from '../src/strategies/dedupe/fuzzyTitle.js';
import { makeEvent } from './_helpers.js';

test('byId: collapses events that share a content-derived id', async () => {
  const a = makeEvent({ title: 'Same Event', source: { name: 's', url: 'https://a.example.com' } });
  const b = makeEvent({ title: 'Same Event', source: { name: 's', url: 'https://b.example.com' } });
  // Same title/startsAt/venue → same id, even though source URLs differ.
  assert.equal(a.id, b.id);
  const out = await byId([a, b], /** @type {any} */ ({}));
  assert.equal(out.length, 1);
});

test('byId: keeps distinct events from the same source URL', async () => {
  // Two different events extracted from one listing page.
  const a = makeEvent({
    title: 'Event A',
    startsAt: '2026-05-02T20:00:00+00:00',
    source: { name: 's', url: 'https://listing.example.com' },
  });
  const b = makeEvent({
    title: 'Event B',
    startsAt: '2026-05-03T20:00:00+00:00',
    source: { name: 's', url: 'https://listing.example.com' },
  });
  const out = await byId([a, b], /** @type {any} */ ({}));
  assert.equal(out.length, 2);
});

test('fuzzyTitle: same-day same-city near-duplicates collapse', async () => {
  const a = makeEvent({
    title: 'Open Mic Night at Comedy Café',
    startsAt: '2026-05-02T20:00:00+00:00',
    venue: { name: 'Comedy Café', city: 'Berlin' },
    source: { name: 's', url: 'https://a.example.com' },
  });
  const b = makeEvent({
    title: 'Open Mic Night Comedy Café Berlin',
    startsAt: '2026-05-02T20:30:00+00:00',
    venue: { name: 'Comedy Café', city: 'Berlin' },
    source: { name: 's', url: 'https://b.example.com' },
  });
  const out = await fuzzyTitle(0.5)([a, b], /** @type {any} */ ({}));
  assert.equal(out.length, 1);
});

test('fuzzyTitle: trigrams catch punctuation/spacing variants tokens miss', async () => {
  // "k pop night" vs "kpop night" — tokens share only "night" (Jaccard 0.25),
  // but char trigrams overlap heavily, so the hybrid still merges them.
  const a = makeEvent({
    title: 'K-Pop Night',
    startsAt: '2026-05-02T20:00:00+00:00',
    source: { name: 's', url: 'https://a.example.com' },
  });
  const b = makeEvent({
    title: 'KPop Night',
    startsAt: '2026-05-02T20:30:00+00:00',
    source: { name: 's', url: 'https://b.example.com' },
  });
  const out = await fuzzyTitle(0.5)([a, b], /** @type {any} */ ({}));
  assert.equal(out.length, 1);
});

test('fuzzyTitle: different cities on the same day are not duplicates', async () => {
  const a = makeEvent({
    title: 'Jazz Night',
    startsAt: '2026-05-02T20:00:00+00:00',
    venue: { name: 'Blue Note', city: 'Berlin' },
    source: { name: 's', url: 'https://a.example.com' },
  });
  const b = makeEvent({
    title: 'Jazz Night',
    startsAt: '2026-05-02T20:00:00+00:00',
    venue: { name: 'Blue Note', city: 'Munich' },
    source: { name: 's', url: 'https://b.example.com' },
  });
  const out = await fuzzyTitle(0.85)([a, b], /** @type {any} */ ({}));
  assert.equal(out.length, 2);
});

test('fuzzyTitle: unrelated titles stay distinct', async () => {
  const a = makeEvent({
    title: 'Stand-Up Comedy Showcase',
    startsAt: '2026-05-02T20:00:00+00:00',
    source: { name: 's', url: 'https://a.example.com' },
  });
  const b = makeEvent({
    title: 'Bach Cello Suites Recital',
    startsAt: '2026-05-02T20:00:00+00:00',
    source: { name: 's', url: 'https://b.example.com' },
  });
  const out = await fuzzyTitle(0.85)([a, b], /** @type {any} */ ({}));
  assert.equal(out.length, 2);
});

test('fuzzyTitle: different days are not duplicates even with same title', async () => {
  const a = makeEvent({
    title: 'Anna Mateur Live',
    startsAt: '2026-05-02T20:00:00+00:00',
    source: { name: 's', url: 'https://a.example.com' },
  });
  const b = makeEvent({
    title: 'Anna Mateur Live',
    startsAt: '2026-05-03T20:00:00+00:00',
    source: { name: 's', url: 'https://b.example.com' },
  });
  const out = await fuzzyTitle(0.85)([a, b], /** @type {any} */ ({}));
  assert.equal(out.length, 2);
});
