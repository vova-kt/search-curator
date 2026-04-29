/**
 * In-memory storage adapter. For tests and ephemeral runs.
 * Mirrors the SQLite adapter's behavior.
 */

import { EventState } from '../../core/eventState.js';

/** @type {Set<import('../../core/types.js').EventStateValue>} */
const VISIBLE_STATES = new Set([EventState.SHOWN, EventState.LIKED, EventState.DISLIKED]);

/**
 * @returns {import('../../core/types.js').StorageAdapter}
 */
export function memory() {
  /** @type {Map<string, import('../../core/types.js').Event>} */
  const events = new Map();
  /** @type {Map<string, string>} */
  const kv = new Map();
  /** @type {Map<string, import('../../core/types.js').SavedQuery>} */
  const savedQueries = new Map();
  /**
   * event_states junction:
   * key `${city}|${queryText}|${eventId}` ->
   *   { eventId, city, queryText, state, reason?, stateAt }
   * @type {Map<string, { eventId: string, city: string, queryText: string, state: import('../../core/types.js').EventStateValue, reason?: string, stateAt: string }>}
   */
  const states = new Map();
  let initialized = false;

  /** @param {{ city: string, queryText: string }} ref */
  const savedKey = (ref) => `${ref.city}|${ref.queryText}`;
  /** @param {{ city: string, queryText: string, eventId: string }} v */
  const stateKey = (v) => `${v.city}|${v.queryText}|${v.eventId}`;

  function ensureOpen() {
    if (!initialized) throw new Error('storage not initialized: call init() first');
  }

  return {
    async init() {
      initialized = true;
    },

    async close() {
      events.clear();
      kv.clear();
      savedQueries.clear();
      states.clear();
      initialized = false;
    },

    async upsertEvents(incoming) {
      ensureOpen();
      const now = new Date().toISOString();
      for (const e of incoming) {
        const existing = events.get(e.id);
        events.set(e.id, {
          ...e,
          firstSeenAt: existing?.firstSeenAt ?? e.firstSeenAt ?? now,
          lastSeenAt: now,
          lastShownAt: existing?.lastShownAt ?? e.lastShownAt,
        });
      }
    },

    async recordEventStates(items, ref) {
      ensureOpen();
      if (items.length === 0) return;
      const now = new Date().toISOString();
      for (const it of items) {
        const key = stateKey({ city: ref.city, queryText: ref.queryText, eventId: it.eventId });
        // FOUND is a "first time we saw it" stamp — it never overwrites a later state.
        if (it.state === EventState.FOUND && states.has(key)) continue;
        states.set(key, {
          eventId: it.eventId,
          city: ref.city,
          queryText: ref.queryText,
          state: it.state,
          reason: it.reason,
          stateAt: now,
        });
        if (VISIBLE_STATES.has(it.state)) {
          const existing = events.get(it.eventId);
          if (existing) events.set(it.eventId, { ...existing, lastShownAt: now });
        }
      }
    },

    async getEventStates(ref) {
      ensureOpen();
      const matches = [...states.values()]
        .filter((s) => s.city === ref.city && s.queryText === ref.queryText)
        .sort((a, b) => b.stateAt.localeCompare(a.stateAt));
      /** @type {import('../../core/types.js').EventStateRecord[]} */
      const out = [];
      for (const s of matches) {
        const e = events.get(s.eventId);
        if (!e) continue;
        out.push({ event: e, state: s.state, reason: s.reason, stateAt: s.stateAt });
      }
      return out;
    },

    async getShownIds(ids, ref) {
      ensureOpen();
      const out = new Set();
      for (const id of ids) {
        const s = states.get(stateKey({ city: ref.city, queryText: ref.queryText, eventId: id }));
        if (s && VISIBLE_STATES.has(s.state)) out.add(id);
      }
      return out;
    },

    async listShown(ref, opts) {
      ensureOpen();
      const matches = [...states.values()]
        .filter((s) => s.city === ref.city && s.queryText === ref.queryText && VISIBLE_STATES.has(s.state))
        .sort((a, b) => b.stateAt.localeCompare(a.stateAt));
      const limited = opts?.limit ? matches.slice(0, opts.limit) : matches;
      /** @type {import('../../core/types.js').Event[]} */
      const out = [];
      for (const s of limited) {
        const e = events.get(s.eventId);
        if (e) out.push(e);
      }
      return out;
    },

    async getEvents(ids) {
      ensureOpen();
      /** @type {import('../../core/types.js').Event[]} */
      const out = [];
      for (const id of ids) {
        const e = events.get(id);
        if (e) out.push(e);
      }
      return out;
    },

    async listSavedQueries(opts) {
      ensureOpen();
      const includeArchived = opts?.includeArchived ?? false;
      return [...savedQueries.values()]
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
      ensureOpen();
      return savedQueries.get(savedKey(ref));
    },

    async upsertSavedQuery(q) {
      ensureOpen();
      const key = savedKey(q);
      const existing = savedQueries.get(key);
      const now = new Date().toISOString();
      const next = {
        ...q,
        excludeKeywords: q.excludeKeywords ?? [],
        archived: q.archived ?? false,
        createdAt: existing?.createdAt ?? q.createdAt ?? now,
        updatedAt: now,
        lastSearchedAt: q.lastSearchedAt ?? existing?.lastSearchedAt,
      };
      savedQueries.set(key, next);
      return next;
    },

    async deleteSavedQuery(ref) {
      ensureOpen();
      savedQueries.delete(savedKey(ref));
    },

    async touchSavedQuery(ref) {
      ensureOpen();
      const existing = savedQueries.get(savedKey(ref));
      if (!existing) return;
      savedQueries.set(savedKey(ref), { ...existing, lastSearchedAt: new Date().toISOString() });
    },

    async getKV(key) {
      ensureOpen();
      return kv.get(key);
    },

    async setKV(key, value) {
      ensureOpen();
      kv.set(key, value);
    },
  };
}
