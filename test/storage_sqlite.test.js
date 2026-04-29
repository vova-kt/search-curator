import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sqlite } from '../src/adapters/storage/sqlite.js';
import { makeEvent } from './_helpers.js';

function tmpDb() {
  return join(tmpdir(), `events-curator-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

test('sqlite: re-init on existing db is idempotent', async () => {
  const path = tmpDb();
  try {
    const s1 = sqlite({ path });
    await s1.init();
    const e = makeEvent({ title: 'Persist' });
    await s1.upsertEvents([e]);
    await s1.close();

    const s2 = sqlite({ path });
    await s2.init();
    const seen = await s2.getSeenIds([e.id]);
    assert.deepEqual([...seen], [e.id]);
    await s2.close();
  } finally {
    if (existsSync(path)) unlinkSync(path);
  }
});

test('sqlite: upsert + getSeenIds round-trip', async () => {
  const path = tmpDb();
  try {
    const s = sqlite({ path });
    await s.init();
    const e = makeEvent({ title: 'Roundtrip' });
    await s.upsertEvents([e]);
    const seen = await s.getSeenIds([e.id, 'evt_missing']);
    assert.deepEqual([...seen], [e.id]);
    const fetched = await s.getEvents([e.id]);
    assert.equal(fetched[0]?.title, 'Roundtrip');
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

test('sqlite: saved queries persist across reopen and bump on touch', async () => {
  const path = tmpDb();
  try {
    const s1 = sqlite({ path });
    await s1.init();
    await s1.upsertSavedQuery({
      city: 'Berlin', queryText: 'stand-up comedy', days: 14, limit: 10,
      excludeKeywords: ['open mic'], guidance: 'intimate venues',
      createdAt: '2026-04-01T00:00:00Z',
    });
    await s1.touchSavedQuery({ city: 'Berlin', queryText: 'stand-up comedy' });
    await s1.close();

    const s2 = sqlite({ path });
    await s2.init();
    const list = await s2.listSavedQueries();
    assert.equal(list.length, 1);
    assert.equal(list[0].guidance, 'intimate venues');
    assert.deepEqual(list[0].excludeKeywords, ['open mic']);
    assert.ok(list[0].lastSearchedAt);
    await s2.deleteSavedQuery({ city: 'Berlin', queryText: 'stand-up comedy' });
    assert.equal((await s2.listSavedQueries()).length, 0);
    await s2.close();
  } finally {
    if (existsSync(path)) unlinkSync(path);
  }
});

test('sqlite: scoped preferences override global', async () => {
  const path = tmpDb();
  try {
    const s = sqlite({ path });
    await s.init();
    await s.updatePreference((p) => ({ ...p, explicitFilters: { excludeKeywords: ['global'] } }));
    await s.updatePreference(
      (p) => ({ ...p, explicitFilters: { excludeKeywords: ['scoped'] } }),
      { city: 'Berlin' },
    );
    const merged = await s.getPreference({ city: 'Berlin' });
    assert.deepEqual(merged.explicitFilters.excludeKeywords, ['scoped']);
    await s.close();
  } finally {
    if (existsSync(path)) unlinkSync(path);
  }
});
