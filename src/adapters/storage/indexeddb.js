/**
 * IndexedDB storage adapter for the browser.
 *
 * Mirrors the SQLite schema. Uses object stores: `events`, `eventStates`, `kv`, `savedQueries`.
 *
 * NOTE: keep this file dependency-free of `node:*` so it can be bundled for browsers.
 */

import { EventState } from '../../core/eventState.js';

/** @type {Set<import('../../core/types.js').EventStateValue>} */
const VISIBLE_STATES = new Set([EventState.SHOWN, EventState.LIKED, EventState.DISLIKED]);
const DB_VERSION = 3;

/** @param {{ city: string, queryText: string }} ref */
const savedKey = (ref) => `${ref.city}|${ref.queryText}`;
/** @param {{ city: string, queryText: string, eventId: string }} v */
const stateKey = (v) => `${v.city}|${v.queryText}|${v.eventId}`;

/**
 * @param {{ name?: string }} [opts]
 * @returns {import('../../core/types.js').StorageAdapter}
 */
export function indexeddb({ name = 'events-curator' } = {}) {
  /** @type {IDBDatabase | null} */
  let db = null;

  function ensureOpen() {
    if (!db) throw new Error('storage not initialized: call init() first');
    return db;
  }

  return {
    async init() {
      db = await openDb(name);
    },

    async close() {
      db?.close();
      db = null;
    },

    async upsertEvents(incoming) {
      const d = ensureOpen();
      const now = new Date().toISOString();
      const tx = d.transaction('events', 'readwrite');
      const store = tx.objectStore('events');
      for (const e of incoming) {
        const existing = await reqAsPromise(store.get(e.id));
        store.put({
          ...e,
          firstSeenAt: existing?.firstSeenAt ?? e.firstSeenAt ?? now,
          lastSeenAt: now,
          lastShownAt: existing?.lastShownAt ?? e.lastShownAt,
        });
      }
      await txDone(tx);
    },

    async recordEventStates(items, ref) {
      const d = ensureOpen();
      if (items.length === 0) return;
      const now = new Date().toISOString();
      const tx = d.transaction(['eventStates', 'events'], 'readwrite');
      const statesStore = tx.objectStore('eventStates');
      const eventsStore = tx.objectStore('events');
      for (const it of items) {
        const _key = stateKey({ city: ref.city, queryText: ref.queryText, eventId: it.eventId });
        // FOUND is a "first time we saw it" stamp — it never overwrites a later state.
        if (it.state === EventState.FOUND) {
          const existing = await reqAsPromise(statesStore.get(_key));
          if (existing) continue;
        }
        statesStore.put({
          _key,
          eventId: it.eventId,
          city: ref.city,
          queryText: ref.queryText,
          state: it.state,
          reason: it.reason,
          stateAt: now,
        });
        if (VISIBLE_STATES.has(it.state)) {
          const e = await reqAsPromise(eventsStore.get(it.eventId));
          if (e) eventsStore.put({ ...e, lastShownAt: now });
        }
      }
      await txDone(tx);
    },

    async getEventStates(ref) {
      const d = ensureOpen();
      const tx = d.transaction(['eventStates', 'events'], 'readonly');
      const statesStore = tx.objectStore('eventStates');
      const idx = statesStore.index('cityQueryStateAt');
      const range = IDBKeyRange.bound(
        [ref.city, ref.queryText, '\u0000'],
        [ref.city, ref.queryText, '\uffff'],
      );
      /** @type {Array<{ eventId: string, state: import('../../core/types.js').EventStateValue, reason?: string, stateAt: string }>} */
      const rows = [];
      await new Promise((resolve, reject) => {
        const req = idx.openCursor(range, 'prev');
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const v = cursor.value;
            rows.push({ eventId: v.eventId, state: v.state, reason: v.reason, stateAt: v.stateAt });
            cursor.continue();
          } else {
            resolve(undefined);
          }
        };
        req.onerror = () => reject(req.error);
      });
      const eventsStore = tx.objectStore('events');
      /** @type {import('../../core/types.js').EventStateRecord[]} */
      const out = [];
      for (const r of rows) {
        const e = await reqAsPromise(eventsStore.get(r.eventId));
        if (e) out.push({ event: e, state: r.state, reason: r.reason, stateAt: r.stateAt });
      }
      await txDone(tx);
      return out;
    },

    async getShownIds(ids, ref) {
      const d = ensureOpen();
      const tx = d.transaction('eventStates', 'readonly');
      const store = tx.objectStore('eventStates');
      const out = new Set();
      for (const id of ids) {
        const row = await reqAsPromise(store.get(stateKey({ city: ref.city, queryText: ref.queryText, eventId: id })));
        if (row && VISIBLE_STATES.has(row.state)) out.add(id);
      }
      await txDone(tx);
      return out;
    },

    async listShown(ref, opts) {
      const d = ensureOpen();
      const tx = d.transaction(['eventStates', 'events'], 'readonly');
      const statesStore = tx.objectStore('eventStates');
      const idx = statesStore.index('cityQueryStateAt');
      const range = IDBKeyRange.bound(
        [ref.city, ref.queryText, '\u0000'],
        [ref.city, ref.queryText, '\uffff'],
      );
      /** @type {Array<{ eventId: string, stateAt: string }>} */
      const rows = [];
      await new Promise((resolve, reject) => {
        const req = idx.openCursor(range, 'prev');
        req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) {
            const v = cursor.value;
            if (VISIBLE_STATES.has(v.state)) {
              rows.push({ eventId: v.eventId, stateAt: v.stateAt });
              if (opts?.limit && rows.length >= opts.limit) { resolve(undefined); return; }
            }
            cursor.continue();
          } else {
            resolve(undefined);
          }
        };
        req.onerror = () => reject(req.error);
      });
      const eventsStore = tx.objectStore('events');
      /** @type {import('../../core/types.js').Event[]} */
      const out = [];
      for (const r of rows) {
        const e = await reqAsPromise(eventsStore.get(r.eventId));
        if (e) out.push(e);
      }
      await txDone(tx);
      return out;
    },

    async getEvents(ids) {
      const d = ensureOpen();
      const tx = d.transaction('events', 'readonly');
      const store = tx.objectStore('events');
      const out = [];
      for (const id of ids) {
        const row = await reqAsPromise(store.get(id));
        if (row) out.push(row);
      }
      await txDone(tx);
      return out;
    },

    async listSavedQueries(opts) {
      const d = ensureOpen();
      const includeArchived = opts?.includeArchived ?? false;
      const tx = d.transaction('savedQueries', 'readonly');
      const all = /** @type {Array<import('../../core/types.js').SavedQuery & { _key: string }>} */ (
        await reqAsPromise(tx.objectStore('savedQueries').getAll())
      );
      await txDone(tx);
      return all
        .map(({ _key, ...q }) => q)
        .filter((q) => includeArchived || !q.archived)
        .sort((a, b) => {
          const al = a.lastSearchedAt;
          const bl = b.lastSearchedAt;
          if (al && bl) return bl.localeCompare(al);
          if (al && !bl) return -1;
          if (!al && bl) return 1;
          return b.createdAt.localeCompare(a.createdAt);
        });
    },

    async getSavedQuery(ref) {
      const d = ensureOpen();
      const tx = d.transaction('savedQueries', 'readonly');
      const row = /** @type {(import('../../core/types.js').SavedQuery & { _key: string }) | undefined} */ (
        await reqAsPromise(tx.objectStore('savedQueries').get(savedKey(ref)))
      );
      await txDone(tx);
      if (!row) return undefined;
      const { _key, ...rest } = row;
      return rest;
    },

    async upsertSavedQuery(q) {
      const d = ensureOpen();
      const tx = d.transaction('savedQueries', 'readwrite');
      const store = tx.objectStore('savedQueries');
      const _key = savedKey(q);
      const existing = await reqAsPromise(store.get(_key));
      const now = new Date().toISOString();
      const next = {
        ...q,
        excludeKeywords: q.excludeKeywords ?? [],
        archived: q.archived ?? false,
        createdAt: existing?.createdAt ?? q.createdAt ?? now,
        updatedAt: now,
        lastSearchedAt: q.lastSearchedAt ?? existing?.lastSearchedAt,
      };
      store.put({ ...next, _key });
      await txDone(tx);
      return next;
    },

    async deleteSavedQuery(ref) {
      const d = ensureOpen();
      const tx = d.transaction('savedQueries', 'readwrite');
      tx.objectStore('savedQueries').delete(savedKey(ref));
      await txDone(tx);
    },

    async touchSavedQuery(ref) {
      const d = ensureOpen();
      const tx = d.transaction('savedQueries', 'readwrite');
      const store = tx.objectStore('savedQueries');
      const existing = await reqAsPromise(store.get(savedKey(ref)));
      if (existing) {
        store.put({ ...existing, lastSearchedAt: new Date().toISOString() });
      }
      await txDone(tx);
    },

    async getKV(key) {
      const d = ensureOpen();
      const tx = d.transaction('kv', 'readonly');
      const row = await reqAsPromise(tx.objectStore('kv').get(key));
      await txDone(tx);
      return row?.value;
    },

    async setKV(key, value) {
      const d = ensureOpen();
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ key, value, updatedAt: new Date().toISOString() });
      await txDone(tx);
    },
  };
}

/**
 * @param {string} name
 * @returns {Promise<IDBDatabase>}
 */
function openDb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      // Drop legacy stores from earlier schema versions.
      if (d.objectStoreNames.contains('preferences')) d.deleteObjectStore('preferences');
      if (d.objectStoreNames.contains('eventViews')) d.deleteObjectStore('eventViews');
      if (d.objectStoreNames.contains('eventStates')) d.deleteObjectStore('eventStates');

      const keyPaths = {
        events: 'id',
        kv: 'key',
        savedQueries: '_key',
        eventStates: '_key',
      };
      for (const [store, keyPath] of Object.entries(keyPaths)) {
        if (!d.objectStoreNames.contains(store)) {
          d.createObjectStore(store, { keyPath });
        }
      }
      const states = req.transaction?.objectStore('eventStates');
      if (states) {
        if (!states.indexNames.contains('eventId')) {
          states.createIndex('eventId', 'eventId', { unique: false });
        }
        if (!states.indexNames.contains('cityQueryStateAt')) {
          states.createIndex('cityQueryStateAt', ['city', 'queryText', 'stateAt'], { unique: false });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @template T
 * @param {IDBRequest<T>} req
 * @returns {Promise<T>}
 */
function reqAsPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {IDBTransaction} tx
 */
function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
