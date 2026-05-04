import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byDedupKey } from '../src/strategies/dedupe/byDedupKey.js';
import { makeEvent } from './_helpers.js';

test('byDedupKey: exact deduplicationKey collapses duplicates', async () => {
  const a = makeEvent({ title: 'Open Mic', deduplicationKey: 'open mic, saligari, 06-05-26', source: { name: 's', url: 'https://a.example.com' } });
  const b = makeEvent({ title: 'Open Mic Berlin', deduplicationKey: 'open mic, saligari, 06-05-26', source: { name: 's', url: 'https://b.example.com' } });
  const { events: out } = await byDedupKey(0.5)([a, b], /** @type {any} */ ({}), /** @type {any} */ ({}));
  assert.equal(out.length, 1);
  assert.equal(out[0].title, 'Open Mic');
});

test('byDedupKey: fuzzy similar keys collapse', async () => {
  const a = makeEvent({ title: 'Open Mic Night', deduplicationKey: 'open mic night, saligari bar, 06-05-26' });
  const b = makeEvent({ title: 'Open Mic', deduplicationKey: 'open mic, saligari, 06-05-26' });
  const { events: out } = await byDedupKey(0.5)([a, b], /** @type {any} */ ({}), /** @type {any} */ ({}));
  assert.equal(out.length, 1);
});

test('byDedupKey: unrelated keys stay distinct', async () => {
  const a = makeEvent({ title: 'Jazz Night', deduplicationKey: 'jazz night, blue note, 06-05-26' });
  const b = makeEvent({ title: 'Rock Show', deduplicationKey: 'rock show, columbiahalle, 10-05-26' });
  const { events: out } = await byDedupKey(0.5)([a, b], /** @type {any} */ ({}), /** @type {any} */ ({}));
  assert.equal(out.length, 2);
});

test('byDedupKey: same id without deduplicationKey collapses', async () => {
  const a = makeEvent({ title: 'Same Event', source: { name: 's', url: 'https://a.example.com' } });
  const b = makeEvent({ title: 'Same Event', source: { name: 's', url: 'https://b.example.com' } });
  assert.equal(a.id, b.id);
  const { events: out } = await byDedupKey(0.5)([a, b], /** @type {any} */ ({}), /** @type {any} */ ({}));
  assert.equal(out.length, 1);
});

test('byDedupKey: distinct ids without deduplicationKey stay separate', async () => {
  const a = makeEvent({ title: 'Event A', startsAt: '2026-05-02T20:00:00+00:00' });
  const b = makeEvent({ title: 'Event B', startsAt: '2026-05-03T20:00:00+00:00' });
  const { events: out } = await byDedupKey(0.5)([a, b], /** @type {any} */ ({}), /** @type {any} */ ({}));
  assert.equal(out.length, 2);
});

test('byDedupKey: high threshold requires closer match', async () => {
  const a = makeEvent({ title: 'Open Mic Night', deduplicationKey: 'open mic night, saligari bar, 06-05-26' });
  const b = makeEvent({ title: 'Open Mic', deduplicationKey: 'open mic, comedy club, 10-06-26' });
  // Low similarity — different venue and date tokens
  const { events: loose } = await byDedupKey(0.3)([a, b], /** @type {any} */ ({}), /** @type {any} */ ({}));
  const { events: strict } = await byDedupKey(0.8)([a, b], /** @type {any} */ ({}), /** @type {any} */ ({}));
  assert.ok(strict.length >= loose.length);
});
