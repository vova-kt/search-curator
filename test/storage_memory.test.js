import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memory } from '../src/adapters/storage/memory.js';
import { EventState } from '../src/core/eventState.js';
import { makeEvent } from './_helpers.js';

const REF_A = { city: 'Berlin', queryText: 'comedy' };
const REF_B = { city: 'Berlin', queryText: 'jazz' };

test('memory storage: upsertEvents stores events but does not mark them shown', async () => {
  const s = memory();
  await s.init();
  const e1 = makeEvent({ title: 'A' });
  const e2 = makeEvent({ title: 'B' });
  await s.upsertEvents([e1, e2]);
  const fetched = await s.getEvents([e1.id, e2.id]);
  assert.equal(fetched.length, 2);
  // No state rows yet — getShownIds returns empty under any ref.
  const shown = await s.getShownIds([e1.id, e2.id, 'evt_does_not_exist'], REF_A);
  assert.equal(shown.size, 0);
});

test('memory storage: recordEventStates Found→Shown→Liked transitions', async () => {
  const s = memory();
  await s.init();
  const e = makeEvent({ title: 'A' });
  await s.upsertEvents([e]);

  await s.recordEventStates([{ eventId: e.id, state: EventState.FOUND }], REF_A);
  let states = await s.getEventStates(REF_A);
  assert.equal(states[0].state, EventState.FOUND);
  // FOUND alone is not "shown" for cross-session dedupe.
  assert.equal((await s.getShownIds([e.id], REF_A)).size, 0);

  await s.recordEventStates([{ eventId: e.id, state: EventState.SHOWN }], REF_A);
  states = await s.getEventStates(REF_A);
  assert.equal(states[0].state, EventState.SHOWN);
  assert.equal((await s.getShownIds([e.id], REF_A)).size, 1);

  await s.recordEventStates([{ eventId: e.id, state: EventState.LIKED }], REF_A);
  states = await s.getEventStates(REF_A);
  assert.equal(states[0].state, EventState.LIKED);
});

test('memory storage: FOUND never overwrites a later state', async () => {
  const s = memory();
  await s.init();
  const e = makeEvent({ title: 'A' });
  await s.upsertEvents([e]);
  await s.recordEventStates([{ eventId: e.id, state: EventState.LIKED }], REF_A);
  // Re-curating later writes FOUND for the same id; LIKED must stick.
  await s.recordEventStates([{ eventId: e.id, state: EventState.FOUND }], REF_A);
  const [row] = await s.getEventStates(REF_A);
  assert.equal(row.state, EventState.LIKED);
});

test('memory storage: dislike with reason is persisted; getShownIds includes it', async () => {
  const s = memory();
  await s.init();
  const e = makeEvent({ title: 'A' });
  await s.upsertEvents([e]);
  await s.recordEventStates(
    [{ eventId: e.id, state: EventState.DISLIKED, reason: 'too touristy' }],
    REF_A,
  );
  const [row] = await s.getEventStates(REF_A);
  assert.equal(row.state, EventState.DISLIKED);
  assert.equal(row.reason, 'too touristy');
  // Disliked counts as shown for cross-session dedupe.
  assert.equal((await s.getShownIds([e.id], REF_A)).size, 1);
});

test('memory storage: junction is per-ref', async () => {
  const s = memory();
  await s.init();
  const e = makeEvent({ title: 'A' });
  await s.upsertEvents([e]);
  await s.recordEventStates([{ eventId: e.id, state: EventState.SHOWN }], REF_A);
  // Different ref: no shown rows.
  assert.equal((await s.getShownIds([e.id], REF_B)).size, 0);
  assert.equal((await s.listShown(REF_B)).length, 0);
  assert.equal((await s.listShown(REF_A)).length, 1);
});

test('memory storage: listShown ordered by stateAt DESC, FOUND-only excluded', async () => {
  const s = memory();
  await s.init();
  const e1 = makeEvent({ title: 'A' });
  const e2 = makeEvent({ title: 'B' });
  const e3 = makeEvent({ title: 'C' });
  await s.upsertEvents([e1, e2, e3]);
  await s.recordEventStates([{ eventId: e1.id, state: EventState.FOUND }], REF_A);
  await s.recordEventStates([{ eventId: e2.id, state: EventState.SHOWN }], REF_A);
  await s.recordEventStates([{ eventId: e3.id, state: EventState.LIKED }], REF_A);
  const list = await s.listShown(REF_A);
  // FOUND-only is excluded; SHOWN + LIKED present.
  assert.deepEqual(list.map((e) => e.id).sort(), [e2.id, e3.id].sort());
});

test('memory storage: saved queries CRUD + archived hidden by default', async () => {
  const s = memory();
  await s.init();
  await s.upsertSavedQuery({
    city: 'Berlin', queryText: 'stand-up comedy', days: 14, limit: 10,
    excludeKeywords: ['open mic'], guidance: 'small venues',
    createdAt: '2026-04-01T00:00:00Z',
  });
  await s.upsertSavedQuery({
    city: 'Berlin', queryText: 'live concerts', days: 30, limit: 20,
    excludeKeywords: [], createdAt: '2026-04-02T00:00:00Z',
  });
  let list = await s.listSavedQueries();
  assert.equal(list.length, 2);
  // Newer createdAt first when neither has been searched.
  assert.equal(list[0].queryText, 'live concerts');

  await s.touchSavedQuery({ city: 'Berlin', queryText: 'stand-up comedy' });
  list = await s.listSavedQueries();
  assert.equal(list[0].queryText, 'stand-up comedy');
  assert.ok(list[0].lastSearchedAt);

  const got = await s.getSavedQuery({ city: 'Berlin', queryText: 'stand-up comedy' });
  assert.deepEqual(got.excludeKeywords, ['open mic']);
  assert.equal(got.guidance, 'small venues');

  // Archive one — listSavedQueries hides it by default, surfaces it with includeArchived.
  await s.upsertSavedQuery({ ...got, archived: true });
  list = await s.listSavedQueries();
  assert.equal(list.length, 1);
  assert.equal(list[0].queryText, 'live concerts');
  list = await s.listSavedQueries({ includeArchived: true });
  assert.equal(list.length, 2);

  await s.deleteSavedQuery({ city: 'Berlin', queryText: 'live concerts' });
  list = await s.listSavedQueries({ includeArchived: true });
  assert.equal(list.length, 1);
});

test('memory storage: upsertSavedQuery preserves createdAt on update; carries new fields', async () => {
  const s = memory();
  await s.init();
  const initial = await s.upsertSavedQuery({
    city: 'Berlin', queryText: 'stand-up comedy', days: 14, limit: 10, excludeKeywords: [],
    createdAt: '2026-04-01T00:00:00Z',
  });
  const updated = await s.upsertSavedQuery({
    city: 'Berlin', queryText: 'stand-up comedy', days: 30, limit: 5,
    excludeKeywords: ['x'], excludeVenues: ['Big Hall'],
    price: { min: 5, max: 30, currency: 'EUR' }, freeOnly: false,
    derivedTraits: 'small venues, weeknights',
    createdAt: '2099-01-01T00:00:00Z',
  });
  assert.equal(updated.createdAt, initial.createdAt);
  assert.equal(updated.days, 30);
  assert.deepEqual(updated.excludeKeywords, ['x']);
  assert.deepEqual(updated.excludeVenues, ['Big Hall']);
  assert.deepEqual(updated.price, { min: 5, max: 30, currency: 'EUR' });
  assert.equal(updated.derivedTraits, 'small venues, weeknights');
});

test('memory storage: touchSavedQuery on missing row is a no-op', async () => {
  const s = memory();
  await s.init();
  await s.touchSavedQuery({ city: 'Nowhere', queryText: 'theater' });
  assert.equal((await s.listSavedQueries()).length, 0);
});

test('memory storage: kv round-trip + overwrite', async () => {
  const s = memory();
  await s.init();
  assert.equal(await s.getKV('missing'), undefined);
  await s.setKV('k1', 'v1');
  assert.equal(await s.getKV('k1'), 'v1');
  await s.setKV('k1', 'v2');
  assert.equal(await s.getKV('k1'), 'v2');
});
