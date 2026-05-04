/**
 * SQLite storage adapter for Node. See docs/storage.md.
 */

import Database from 'better-sqlite3';
import { EventState } from '../../core/eventState.js';

/** @type {import('../../core/types.js').EventStateValue[]} */
const VISIBLE_STATES = [EventState.SHOWN, EventState.LIKED, EventState.DISLIKED];

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
    occurrences_json TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    last_shown_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_city ON events(city);
  CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events(starts_at);

  CREATE TABLE IF NOT EXISTS event_states (
    event_id TEXT NOT NULL,
    city TEXT NOT NULL,
    query_text TEXT NOT NULL,
    state TEXT NOT NULL,
    reason TEXT,
    state_at TEXT NOT NULL,
    PRIMARY KEY (event_id, city, query_text)
  );
  CREATE INDEX IF NOT EXISTS idx_event_states_query ON event_states(city, query_text, state_at DESC);
  CREATE INDEX IF NOT EXISTS idx_event_states_event ON event_states(event_id);

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
    exclude_venues_json TEXT NOT NULL DEFAULT '[]',
    price_json TEXT,
    free_only INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    guidance TEXT,
    derived_traits TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT,
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
          venue_json, source_json, price_json, occurrences_json,
          first_seen_at, last_seen_at, last_shown_at
        ) VALUES (
          @id, @title, @description, @starts_at, @ends_at, @city,
          @venue_json, @source_json, @price_json, @occurrences_json,
          @first_seen_at, @last_seen_at, @last_shown_at
        )
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          venue_json = excluded.venue_json,
          source_json = excluded.source_json,
          price_json = excluded.price_json,
          occurrences_json = excluded.occurrences_json,
          last_seen_at = excluded.last_seen_at
      `);
      const tx = d.transaction((rows) => {
        for (const e of rows) stmt.run(eventToRow(e, now));
      });
      tx(events);
    },

    async recordEventStates(items, ref) {
      const d = ensureOpen();
      if (items.length === 0) return;
      const now = new Date().toISOString();
      // FOUND is a "first time we saw it" stamp — it never overwrites a later state.
      // All other states overwrite (the user's latest signal wins).
      const insertIfAbsent = d.prepare(`
        INSERT INTO event_states (event_id, city, query_text, state, reason, state_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id, city, query_text) DO NOTHING
      `);
      const upsert = d.prepare(`
        INSERT INTO event_states (event_id, city, query_text, state, reason, state_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id, city, query_text) DO UPDATE SET
          state = excluded.state,
          reason = excluded.reason,
          state_at = excluded.state_at
      `);
      const bumpEvent = d.prepare(`UPDATE events SET last_shown_at = ? WHERE id = ?`);
      const tx = d.transaction(() => {
        for (const it of items) {
          const stmt = it.state === EventState.FOUND ? insertIfAbsent : upsert;
          stmt.run(it.eventId, ref.city, ref.queryText, it.state, it.reason ?? null, now);
          if (VISIBLE_STATES.includes(it.state)) bumpEvent.run(now, it.eventId);
        }
      });
      tx();
    },

    async getEventStates(ref) {
      const d = ensureOpen();
      const rows = /** @type {(EventRow & { state: string, reason: string|null, state_at: string })[]} */ (
        d.prepare(`
          SELECT e.*, s.state AS state, s.reason AS reason, s.state_at AS state_at
          FROM event_states s
          JOIN events e ON e.id = s.event_id
          WHERE s.city = ? AND s.query_text = ?
          ORDER BY s.state_at DESC
        `).all(ref.city, ref.queryText)
      );
      return rows.map((r) => ({
        event: rowToEvent(r),
        state: /** @type {import('../../core/types.js').EventStateValue} */ (r.state),
        reason: r.reason ?? undefined,
        stateAt: r.state_at,
      }));
    },

    async getShownIds(ids, ref) {
      const d = ensureOpen();
      if (ids.length === 0) return new Set();
      const placeholders = ids.map(() => '?').join(',');
      const statePlaceholders = VISIBLE_STATES.map(() => '?').join(',');
      const rows = /** @type {{ event_id: string }[]} */ (
        d.prepare(`
          SELECT DISTINCT event_id FROM event_states
          WHERE event_id IN (${placeholders})
            AND city = ? AND query_text = ?
            AND state IN (${statePlaceholders})
        `).all(...ids, ref.city, ref.queryText, ...VISIBLE_STATES)
      );
      return new Set(rows.map((r) => r.event_id));
    },

    async listShown(ref, opts) {
      const d = ensureOpen();
      const limit = opts?.limit;
      const statePlaceholders = VISIBLE_STATES.map(() => '?').join(',');
      const sql = `
        SELECT e.* FROM events e
        JOIN event_states s ON s.event_id = e.id
        WHERE s.city = ? AND s.query_text = ?
          AND s.state IN (${statePlaceholders})
        ORDER BY s.state_at DESC
        ${limit ? 'LIMIT ?' : ''}
      `;
      const params = limit
        ? [ref.city, ref.queryText, ...VISIBLE_STATES, limit]
        : [ref.city, ref.queryText, ...VISIBLE_STATES];
      const rows = /** @type {EventRow[]} */ (d.prepare(sql).all(...params));
      return rows.map(rowToEvent);
    },

    async listSavedQueries(opts) {
      const d = ensureOpen();
      const includeArchived = opts?.includeArchived ?? false;
      const sql = `
        SELECT * FROM saved_queries
        ${includeArchived ? '' : 'WHERE archived = 0'}
        ORDER BY (last_searched_at IS NULL), last_searched_at DESC, created_at DESC
      `;
      const rows = /** @type {SavedQueryRow[]} */ (d.prepare(sql).all());
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
      const now = new Date().toISOString();
      const next = {
        ...q,
        excludeKeywords: q.excludeKeywords ?? [],
        archived: q.archived ?? false,
        createdAt: existing?.created_at ?? q.createdAt ?? now,
        updatedAt: now,
      };
      d.prepare(`
        INSERT INTO saved_queries (
          city, query_text, days, query_limit,
          exclude_keywords_json, exclude_venues_json, price_json, free_only, archived,
          guidance, derived_traits,
          created_at, updated_at, last_searched_at
        ) VALUES (
          @city, @query_text, @days, @query_limit,
          @exclude_keywords_json, @exclude_venues_json, @price_json, @free_only, @archived,
          @guidance, @derived_traits,
          @created_at, @updated_at, @last_searched_at
        )
        ON CONFLICT(city, query_text) DO UPDATE SET
          days = excluded.days,
          query_limit = excluded.query_limit,
          exclude_keywords_json = excluded.exclude_keywords_json,
          exclude_venues_json = excluded.exclude_venues_json,
          price_json = excluded.price_json,
          free_only = excluded.free_only,
          archived = excluded.archived,
          guidance = excluded.guidance,
          derived_traits = excluded.derived_traits,
          updated_at = excluded.updated_at,
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
 * @property {string|null} occurrences_json
 * @property {string} first_seen_at
 * @property {string} last_seen_at
 * @property {string|null} last_shown_at
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
    occurrences_json: e.occurrences ? JSON.stringify(e.occurrences) : null,
    first_seen_at: e.firstSeenAt ?? now,
    last_seen_at: now,
    last_shown_at: e.lastShownAt ?? null,
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
    occurrences: row.occurrences_json ? JSON.parse(row.occurrences_json) : undefined,
    score: { queryIntent: 0, location: 0, dates: 0, languageIntent: 0, quality: 0 },
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastShownAt: row.last_shown_at ?? undefined,
  };
}

/**
 * @typedef {Object} SavedQueryRow
 * @property {string} city
 * @property {string} query_text
 * @property {number} days
 * @property {number} query_limit
 * @property {string} exclude_keywords_json
 * @property {string} exclude_venues_json
 * @property {string|null} price_json
 * @property {number} free_only
 * @property {number} archived
 * @property {string|null} guidance
 * @property {string|null} derived_traits
 * @property {string} created_at
 * @property {string|null} updated_at
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
    exclude_venues_json: JSON.stringify(q.excludeVenues ?? []),
    price_json: q.price ? JSON.stringify(q.price) : null,
    free_only: q.freeOnly ? 1 : 0,
    archived: q.archived ? 1 : 0,
    guidance: q.guidance ?? null,
    derived_traits: q.derivedTraits ?? null,
    created_at: q.createdAt,
    updated_at: q.updatedAt ?? null,
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
    excludeVenues: JSON.parse(row.exclude_venues_json),
    price: row.price_json ? JSON.parse(row.price_json) : undefined,
    freeOnly: row.free_only === 1,
    archived: row.archived === 1,
    guidance: row.guidance ?? undefined,
    derivedTraits: row.derived_traits ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
    lastSearchedAt: row.last_searched_at ?? undefined,
  };
}
