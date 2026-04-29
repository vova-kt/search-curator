/**
 * IndexedDB storage adapter for the browser.
 *
 * Mirrors the SQLite schema. Uses three object stores: `events`, `preferences`, `kv`.
 *
 * NOTE: keep this file dependency-free of `node:*` so it can be bundled for browsers.
 */

import { scopeKey, effectiveScopeKeys, emptyPreference, mergePreferences } from './scope.js';

const DB_VERSION = 1;

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
        });
      }
      await txDone(tx);
    },

    async getSeenIds(ids) {
      const d = ensureOpen();
      const tx = d.transaction('events', 'readonly');
      const store = tx.objectStore('events');
      const out = new Set();
      for (const id of ids) {
        const row = await reqAsPromise(store.get(id));
        if (row) out.add(id);
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

    async getPreference(scope) {
      const d = ensureOpen();
      const keys = effectiveScopeKeys(scope);
      const tx = d.transaction('preferences', 'readonly');
      const store = tx.objectStore('preferences');
      const rows = [];
      for (const k of keys) {
        const row = await reqAsPromise(store.get(k));
        if (row) rows.push(row);
      }
      await txDone(tx);
      return mergePreferences(rows.length ? rows : [emptyPreference()]);
    },

    async updatePreference(updater, scope) {
      const d = ensureOpen();
      const key = scopeKey(scope);
      const tx = d.transaction('preferences', 'readwrite');
      const store = tx.objectStore('preferences');
      const existing = await reqAsPromise(store.get(key));
      const current = existing ?? emptyPreference();
      const next = updater(current);
      next.updatedAt = new Date().toISOString();
      store.put({ ...next, scope: key });
      await txDone(tx);
      return next;
    },

    async clearPreference(scope) {
      const d = ensureOpen();
      const tx = d.transaction('preferences', 'readwrite');
      const store = tx.objectStore('preferences');
      if (!scope || (!scope.city && !scope.category)) {
        store.clear();
      } else {
        store.delete(scopeKey(scope));
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
      for (const store of ['events', 'preferences', 'kv']) {
        if (!d.objectStoreNames.contains(store)) {
          d.createObjectStore(store, { keyPath: store === 'preferences' ? 'scope' : store === 'events' ? 'id' : 'key' });
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
