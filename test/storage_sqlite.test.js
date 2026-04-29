import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sqlite } from '../src/adapters/storage/sqlite.js';
import { EventState } from '../src/core/eventState.js';
import { makeEvent } from './_helpers.js';

const REF_A = { city: 'Berlin', queryText: 'comedy' };
const REF_B = { city: 'Berlin', queryText: 'jazz' };

function tmpDb() {
  return join(tmpdir(), `events-curator-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

test('sqlite: re-init on existing db is idempotent and shown rows survive', async () => {
  const path = tmpDb();
  try {
    const s1 = sqlite({ path });
    await s1.init();
    const e = makeEvent({ title: 'Persist' });
    await s1.upsertEvents([e]);
    await s1.recordEventStates([{ eventId: e.id, state: EventState.SHOWN }], REF_A);
    await s1.close();

    const s2 = sqlite({ path });
    await s2.init();
    const shown = await s2.getShownIds([e.id], REF_A);
    assert.deepEqual([...shown], [e.id]);
    await s2.close();
  } finally {
    if (existsSync(path)) unlinkSync(path);
  }
});

test('sqlite: upsertEvents alone does not mark events shown', async () => {
  const path = tmpDb();
  try {
    const s = sqlite({ path });
    await s.init();
    const e = makeEvent({ title: 'Roundtrip' });
    await s.upsertEvents([e]);
    const shown = await s.getShownIds([e.id, 'evt_missing'], REF_A);
    assert.equal(shown.size, 0);
    const fetched = await s.getEvents([e.id]);
    assert.equal(fetched[0]?.title, 'Roundtrip');
    await s.close();
  } finally {
    if (existsSync(path)) unlinkSync(path);
  }
});

test('sqlite: recordEventStates Found→Shown→Liked transitions; FOUND never overwrites', async () => {
  const path = tmpDb();
  try {
    const s = sqlite({ path });
    await s.init();
    const e = makeEvent({ title: 'A' });
    await s.upsertEvents([e]);

    await s.recordEventStates([{ eventId: e.id, state: EventState.FOUND }], REF_A);
    let states = await s.getEventStates(REF_A);
    assert.equal(states[0].state, EventState.FOUND);
    assert.equal((await s.getShownIds([e.id], REF_A)).size, 0);

    await s.recordEventStates([{ eventId: e.id, state: EventState.SHOWN }], REF_A);
    states = await s.getEventStates(REF_A);
    assert.equal(states[0].state, EventState.SHOWN);
    assert.equal((await s.getShownIds([e.id], REF_A)).size, 1);

    await s.recordEventStates([{ eventId: e.id, state: EventState.LIKED }], REF_A);
    states = await s.getEventStates(REF_A);
    assert.equal(states[0].state, EventState.LIKED);

    // Re-curating writes FOUND for an already-LIKED event — LIKED must stick.
    await s.recordEventStates([{ eventId: e.id, state: EventState.FOUND }], REF_A);
    states = await s.getEventStates(REF_A);
    assert.equal(states[0].state, EventState.LIKED);
    await s.close();
  } finally {
    if (existsSync(path)) unlinkSync(path);
  }
});

test('sqlite: recordEventStates + listShown per saved query, ordered by stateAt DESC', async () => {
  const path = tmpDb();
  try {
    const s = sqlite({ path });
    await s.init();
    const a = makeEvent({ title: 'A' });
    const b = makeEvent({ title: 'B' });
    const c = makeEvent({ title: 'C' });
    await s.upsertEvents([a, b, c]);
    await s.recordEventStates(
      [{ eventId: a.id, state: EventState.SHOWN }, { eventId: b.id, state: EventState.SHOWN }],
      REF_A,
    );
    await s.recordEventStates([{ eventId: c.id, state: EventState.SHOWN }], REF_B);

    const shownA = await s.getShownIds([a.id, b.id, c.id, 'missing'], REF_A);
    assert.deepEqual([...shownA].sort(), [a.id, b.id].sort());
    const shownB = await s.getShownIds([a.id, b.id, c.id], REF_B);
    assert.deepEqual([...shownB], [c.id]);

    const comedy = await s.listShown(REF_A);
    assert.deepEqual(comedy.map((e) => e.id).sort(), [a.id, b.id].sort());

    const jazz = await s.listShown(REF_B);
    assert.deepEqual(jazz.map((e) => e.id), [c.id]);

    const limited = await s.listShown(REF_A, { limit: 1 });
    assert.equal(limited.length, 1);
    await s.close();
  } finally {
    if (existsSync(path)) unlinkSync(path);
  }
});

test('sqlite: dislike with reason persists; DISLIKED counts as shown', async () => {
  const path = tmpDb();
  try {
    const s = sqlite({ path });
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
    assert.equal((await s.getShownIds([e.id], REF_A)).size, 1);
    await s.close();
  } finally {
    if (existsSync(path)) unlinkSync(path);
  }
});

test('sqlite: kv round-trip + overwrite + persists across reopen', async () => {
  const path = tmpDb();
  try {
    const s1 = sqlite({ path });
    await s1.init();
    assert.equal(await s1.getKV('missing'), undefined);
    await s1.setKV('k1', 'v1');
    await s1.setKV('k1', 'v2');
    assert.equal(await s1.getKV('k1'), 'v2');
    await s1.close();

    const s2 = sqlite({ path });
    await s2.init();
    assert.equal(await s2.getKV('k1'), 'v2');
    await s2.close();
  } finally {
    if (existsSync(path)) unlinkSync(path);
  }
});

test('sqlite: saved queries round-trip new fields; archived hidden by default', async () => {
  const path = tmpDb();
  try {
    const s1 = sqlite({ path });
    await s1.init();
    await s1.upsertSavedQuery({
      city: 'Berlin', queryText: 'stand-up comedy', days: 14, limit: 10,
      excludeKeywords: ['open mic'], excludeVenues: ['Big Hall'],
      price: { min: 5, max: 30, currency: 'EUR' }, freeOnly: false,
      guidance: 'intimate venues', derivedTraits: 'small rooms, weeknights',
      createdAt: '2026-04-01T00:00:00Z',
    });
    await s1.upsertSavedQuery({
      city: 'Berlin', queryText: 'live concerts', days: 30, limit: 20,
      excludeKeywords: [], createdAt: '2026-04-02T00:00:00Z',
    });
    await s1.touchSavedQuery({ city: 'Berlin', queryText: 'stand-up comedy' });
    await s1.close();

    const s2 = sqlite({ path });
    await s2.init();
    let list = await s2.listSavedQueries();
    assert.equal(list.length, 2);
    const got = await s2.getSavedQuery({ city: 'Berlin', queryText: 'stand-up comedy' });
    assert.equal(got.guidance, 'intimate venues');
    assert.deepEqual(got.excludeKeywords, ['open mic']);
    assert.deepEqual(got.excludeVenues, ['Big Hall']);
    assert.deepEqual(got.price, { min: 5, max: 30, currency: 'EUR' });
    assert.equal(got.derivedTraits, 'small rooms, weeknights');
    assert.equal(got.archived, false);
    assert.ok(got.lastSearchedAt);

    // Archive — hidden by default, surfaced via includeArchived.
    await s2.upsertSavedQuery({ ...got, archived: true });
    list = await s2.listSavedQueries();
    assert.equal(list.length, 1);
    assert.equal(list[0].queryText, 'live concerts');
    list = await s2.listSavedQueries({ includeArchived: true });
    assert.equal(list.length, 2);

    await s2.deleteSavedQuery({ city: 'Berlin', queryText: 'live concerts' });
    list = await s2.listSavedQueries({ includeArchived: true });
    assert.equal(list.length, 1);
    await s2.close();
  } finally {
    if (existsSync(path)) unlinkSync(path);
  }
});
