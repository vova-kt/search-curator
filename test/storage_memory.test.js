import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memory } from '../src/adapters/storage/memory.js';
import { makeEvent } from './_helpers.js';

test('memory storage: upsertEvents + getSeenIds', async () => {
  const s = memory();
  await s.init();
  const e1 = makeEvent({ title: 'A' });
  const e2 = makeEvent({ title: 'B' });
  await s.upsertEvents([e1, e2]);
  const seen = await s.getSeenIds([e1.id, e2.id, 'evt_does_not_exist']);
  assert.deepEqual([...seen].sort(), [e1.id, e2.id].sort());
});

test('memory storage: preferences scope merge — scoped overrides global', async () => {
  const s = memory();
  await s.init();
  await s.updatePreference((p) => ({ ...p, explicitFilters: { excludeKeywords: ['global-kw'] } }));
  await s.updatePreference(
    (p) => ({ ...p, explicitFilters: { excludeKeywords: ['city-kw'] } }),
    { city: 'Berlin' },
  );
  const merged = await s.getPreference({ city: 'Berlin' });
  assert.deepEqual(merged.explicitFilters.excludeKeywords, ['city-kw']);
});

test('memory storage: clearPreference scope', async () => {
  const s = memory();
  await s.init();
  await s.updatePreference((p) => ({ ...p, explicitFilters: { excludeKeywords: ['x'] } }));
  await s.updatePreference((p) => ({ ...p, explicitFilters: { excludeKeywords: ['y'] } }), { city: 'Berlin' });
  await s.clearPreference({ city: 'Berlin' });
  const after = await s.getPreference({ city: 'Berlin' });
  // City-scoped row gone; global row remains.
  assert.deepEqual(after.explicitFilters.excludeKeywords, ['x']);
});

test('memory storage: clearPreference() with no args wipes all', async () => {
  const s = memory();
  await s.init();
  await s.updatePreference((p) => ({ ...p, explicitFilters: { excludeKeywords: ['x'] } }));
  await s.updatePreference((p) => ({ ...p, explicitFilters: { excludeKeywords: ['y'] } }), { city: 'Berlin' });
  await s.clearPreference();
  const after = await s.getPreference({ city: 'Berlin' });
  assert.deepEqual(after.liked, []);
  assert.deepEqual(after.explicitFilters, {});
});

test('memory storage: liked/disliked deduped on merge', async () => {
  const s = memory();
  await s.init();
  const ref = { id: 'evt_x', title: 'X', category: 'comedy', venue: { name: 'V', city: 'Berlin' }, startsAt: '2026-05-02' };
  await s.updatePreference((p) => ({ ...p, liked: [ref] }));
  await s.updatePreference((p) => ({ ...p, liked: [ref] }));
  const got = await s.getPreference();
  assert.equal(got.liked.length, 1);
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
