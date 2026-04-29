/**
 * SQLite storage adapter for Node. See docs/storage.md.
 */

import Database from 'better-sqlite3';
import { scopeKey, effectiveScopeKeys, emptyPreference, mergePreferences } from './scope.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    starts_at TEXT NOT NULL,
    ends_at TEXT,
    city TEXT NOT NULL,
    venue_json TEXT NOT NULL,
    source_json TEXT NOT NULL,
    price_json TEXT,
    subcategories_json TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_city ON events(city);
  CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);

  CREATE TABLE IF NOT EXISTS preferences (
    scope TEXT PRIMARY KEY,
    liked_json TEXT NOT NULL,
    disliked_json TEXT NOT NULL,
    filters_json TEXT NOT NULL,
    derived_traits TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS saved_queries (
    city TEXT NOT NULL,
    query_text TEXT NOT NULL,
    days INTEGER NOT NULL,
    query_limit INTEGER NOT NULL,
    exclude_keywords_json TEXT NOT NULL,
    guidance TEXT,
    created_at TEXT NOT NULL,
    last_searched_at TEXT,
    PRIMARY KEY (city, query_text)
  );
`;

/**
 * @param {{ path: string }} opts
 * @returns {import('../../core/types.js').StorageAdapter}
 */
export function sqlite({ path }) {
  /** @type {Database.Database | null} */
  let db = null;

  function ensureOpen() {
    if (!db) throw new Error('storage not initialized: call init() first');
    return db;
  }

  return {
    async init() {
      db = new Database(path);
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');
      db.exec(SCHEMA);
    },

    async close() {
      db?.close();
      db = null;
    },

    async upsertEvents(events) {
      const d = ensureOpen();
      const now = new Date().toISOString();
      const stmt = d.prepare(`
        INSERT INTO events (
          id, title, description, starts_at, ends_at, city,
          venue_json, source_json, price_json, subcategories_json,
          first_seen_at, last_seen_at
        ) VALUES (
          @id, @title, @description, @starts_at, @ends_at, @city,
          @venue_json, @source_json, @price_json, @subcategories_json,
          @first_seen_at, @last_seen_at
        )
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          venue_json = excluded.venue_json,
          source_json = excluded.source_json,
          price_json = excluded.price_json,
          subcategories_json = excluded.subcategories_json,
          last_seen_at = excluded.last_seen_at
      `);
      const tx = d.transaction((rows) => {
        for (const e of rows) stmt.run(eventToRow(e, now));
      });
      tx(events);
    },

    async getSeenIds(ids) {
      const d = ensureOpen();
      if (ids.length === 0) return new Set();
      const placeholders = ids.map(() => '?').join(',');
      const rows = /** @type {{ id: string }[]} */ (
        d.prepare(`SELECT id FROM events WHERE id IN (${placeholders})`).all(...ids)
      );
      return new Set(rows.map((r) => r.id));
    },

    async getEvents(ids) {
      const d = ensureOpen();
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => '?').join(',');
      const rows = /** @type {EventRow[]} */ (
        d.prepare(`SELECT * FROM events WHERE id IN (${placeholders})`).all(...ids)
      );
      return rows.map(rowToEvent);
    },

    async getPreference(scope) {
      const d = ensureOpen();
      const keys = effectiveScopeKeys(scope);
      const placeholders = keys.map(() => '?').join(',');
      const rows = /** @type {PreferenceRow[]} */ (
        d.prepare(`SELECT * FROM preferences WHERE scope IN (${placeholders})`).all(...keys)
      );
      // Order rows to match keys order (so most-specific overrides global).
      const ordered = keys
        .map((k) => rows.find((r) => r.scope === k))
        .filter(/** @returns {r is PreferenceRow} */ (r) => Boolean(r))
        .map(rowToPreference);
      return mergePreferences(ordered.length ? ordered : [emptyPreference()]);
    },

    async updatePreference(updater, scope) {
      const d = ensureOpen();
      const key = scopeKey(scope);
      const tx = d.transaction(() => {
        const row = /** @type {PreferenceRow | undefined} */ (
          d.prepare('SELECT * FROM preferences WHERE scope = ?').get(key)
        );
        const current = row ? rowToPreference(row) : emptyPreference();
        const next = updater(current);
        next.updatedAt = new Date().toISOString();
        d.prepare(`
          INSERT INTO preferences (scope, liked_json, disliked_json, filters_json, derived_traits, updated_at)
          VALUES (@scope, @liked_json, @disliked_json, @filters_json, @derived_traits, @updated_at)
          ON CONFLICT(scope) DO UPDATE SET
            liked_json = excluded.liked_json,
            disliked_json = excluded.disliked_json,
            filters_json = excluded.filters_json,
            derived_traits = excluded.derived_traits,
            updated_at = excluded.updated_at
        `).run(preferenceToRow(key, next));
        return next;
      });
      return tx();
    },

    async clearPreference(scope) {
      const d = ensureOpen();
      if (!scope || (!scope.city && !scope.queryText)) {
        d.prepare('DELETE FROM preferences').run();
        return;
      }
      const key = scopeKey(scope);
      d.prepare('DELETE FROM preferences WHERE scope = ?').run(key);
    },

    async listSavedQueries() {
      const d = ensureOpen();
      const rows = /** @type {SavedQueryRow[]} */ (
        d.prepare(`
          SELECT * FROM saved_queries
          ORDER BY (last_searched_at IS NULL), last_searched_at DESC, created_at DESC
        `).all()
      );
      return rows.map(rowToSavedQuery);
    },

    async getSavedQuery({ city, queryText }) {
      const d = ensureOpen();
      const row = /** @type {SavedQueryRow | undefined} */ (
        d.prepare('SELECT * FROM saved_queries WHERE city = ? AND query_text = ?').get(city, queryText)
      );
      return row ? rowToSavedQuery(row) : undefined;
    },

    async upsertSavedQuery(q) {
      const d = ensureOpen();
      const existing = /** @type {{ created_at: string } | undefined} */ (
        d.prepare('SELECT created_at FROM saved_queries WHERE city = ? AND query_text = ?').get(q.city, q.queryText)
      );
      const next = {
        ...q,
        createdAt: existing?.created_at ?? q.createdAt ?? new Date().toISOString(),
      };
      d.prepare(`
        INSERT INTO saved_queries (
          city, query_text, days, query_limit, exclude_keywords_json, guidance,
          created_at, last_searched_at
        ) VALUES (
          @city, @query_text, @days, @query_limit, @exclude_keywords_json, @guidance,
          @created_at, @last_searched_at
        )
        ON CONFLICT(city, query_text) DO UPDATE SET
          days = excluded.days,
          query_limit = excluded.query_limit,
          exclude_keywords_json = excluded.exclude_keywords_json,
          guidance = excluded.guidance,
          last_searched_at = excluded.last_searched_at
      `).run(savedQueryToRow(next));
      return next;
    },

    async deleteSavedQuery({ city, queryText }) {
      const d = ensureOpen();
      d.prepare('DELETE FROM saved_queries WHERE city = ? AND query_text = ?').run(city, queryText);
    },

    async touchSavedQuery({ city, queryText }) {
      const d = ensureOpen();
      d.prepare(
        'UPDATE saved_queries SET last_searched_at = ? WHERE city = ? AND query_text = ?',
      ).run(new Date().toISOString(), city, queryText);
    },

    async getKV(key) {
      const d = ensureOpen();
      const row = /** @type {{ value: string } | undefined} */ (
        d.prepare('SELECT value FROM kv WHERE key = ?').get(key)
      );
      return row?.value;
    },

    async setKV(key, value) {
      const d = ensureOpen();
      d.prepare(`
        INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(key, value, new Date().toISOString());
    },
  };
}

/**
 * @typedef {Object} EventRow
 * @property {string} id
 * @property {string} title
 * @property {string|null} description
 * @property {string} starts_at
 * @property {string|null} ends_at
 * @property {string} city
 * @property {string} venue_json
 * @property {string} source_json
 * @property {string|null} price_json
 * @property {string|null} subcategories_json
 * @property {string} first_seen_at
 * @property {string} last_seen_at
 */

/**
 * @typedef {Object} PreferenceRow
 * @property {string} scope
 * @property {string} liked_json
 * @property {string} disliked_json
 * @property {string} filters_json
 * @property {string|null} derived_traits
 * @property {string} updated_at
 */

/**
 * @param {import('../../core/types.js').Event} e
 * @param {string} now
 */
function eventToRow(e, now) {
  return {
    id: e.id,
    title: e.title,
    description: e.description ?? null,
    starts_at: e.startsAt,
    ends_at: e.endsAt ?? null,
    city: e.venue.city,
    venue_json: JSON.stringify(e.venue),
    source_json: JSON.stringify(e.source),
    price_json: e.price ? JSON.stringify(e.price) : null,
    subcategories_json: e.subcategories ? JSON.stringify(e.subcategories) : null,
    first_seen_at: e.firstSeenAt ?? now,
    last_seen_at: now,
  };
}

/**
 * @param {EventRow} row
 * @returns {import('../../core/types.js').Event}
 */
function rowToEvent(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    startsAt: row.starts_at,
    endsAt: row.ends_at ?? undefined,
    venue: JSON.parse(row.venue_json),
    source: JSON.parse(row.source_json),
    price: row.price_json ? JSON.parse(row.price_json) : undefined,
    subcategories: row.subcategories_json ? JSON.parse(row.subcategories_json) : undefined,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

/**
 * @param {string} key
 * @param {import('../../core/types.js').Preference} p
 */
function preferenceToRow(key, p) {
  return {
    scope: key,
    liked_json: JSON.stringify(p.liked),
    disliked_json: JSON.stringify(p.disliked),
    filters_json: JSON.stringify(p.explicitFilters),
    derived_traits: p.derivedTraits ?? null,
    updated_at: p.updatedAt ?? new Date().toISOString(),
  };
}

/**
 * @typedef {Object} SavedQueryRow
 * @property {string} city
 * @property {string} query_text
 * @property {number} days
 * @property {number} query_limit
 * @property {string} exclude_keywords_json
 * @property {string|null} guidance
 * @property {string} created_at
 * @property {string|null} last_searched_at
 */

/**
 * @param {import('../../core/types.js').SavedQuery} q
 */
function savedQueryToRow(q) {
  return {
    city: q.city,
    query_text: q.queryText,
    days: q.days,
    query_limit: q.limit,
    exclude_keywords_json: JSON.stringify(q.excludeKeywords ?? []),
    guidance: q.guidance ?? null,
    created_at: q.createdAt,
    last_searched_at: q.lastSearchedAt ?? null,
  };
}

/**
 * @param {SavedQueryRow} row
 * @returns {import('../../core/types.js').SavedQuery}
 */
function rowToSavedQuery(row) {
  return {
    city: row.city,
    queryText: row.query_text,
    days: row.days,
    limit: row.query_limit,
    excludeKeywords: JSON.parse(row.exclude_keywords_json),
    guidance: row.guidance ?? undefined,
    createdAt: row.created_at,
    lastSearchedAt: row.last_searched_at ?? undefined,
  };
}

/**
 * @param {PreferenceRow} row
 * @returns {import('../../core/types.js').Preference}
 */
function rowToPreference(row) {
  return {
    liked: JSON.parse(row.liked_json),
    disliked: JSON.parse(row.disliked_json),
    explicitFilters: JSON.parse(row.filters_json),
    derivedTraits: row.derived_traits ?? undefined,
    updatedAt: row.updated_at,
  };
}
