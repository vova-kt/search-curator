# Storage

Storage holds three things: **events** (so we can dedupe across sessions and recall what was shown), **preferences** (the user's accumulated likes/dislikes/filters), and a **generic kv** table for adapter-agnostic caches (e.g. query-expansion).

The library is in active pre-`1.0` development — there is no migration system. The schema is defined once per adapter and applied idempotently on `init()`. When the schema needs to change, edit it in place and reset any local databases. Don't add migrations.

## Backends

| Backend     | Module                                | Where    | When to use                  |
| ----------- | ------------------------------------- | -------- | ---------------------------- |
| `sqlite`    | `adapters/storage/sqlite.js`          | Node     | default for CLI / scripts    |
| `indexeddb` | `adapters/storage/indexeddb.js`       | Browser  | web-app integration          |
| `memory`    | `adapters/storage/memory.js`          | Anywhere | tests, ephemeral runs        |

All three implement the same `StorageAdapter` interface (see [adapters.md](adapters.md)).

## Schema

Logical tables (mapped to object stores in IndexedDB):

> **Saved queries.** The TUI persists user-defined searches in a `saved_queries` table (object store `savedQueries` on IndexedDB). Identity is `(city, category)`; days, limit, exclude-keywords and rank guidance are editable fields on the row. The curator's `curate()` calls `touchSavedQuery({ city, category })` after a successful run to bump `last_searched_at`. See the schema below.

### `events`

| column        | type     | notes                                      |
| ------------- | -------- | ------------------------------------------ |
| `id`          | TEXT PK  | canonical hash of `(title, startsAt, venue, city)` |
| `title`       | TEXT     |                                            |
| `description` | TEXT     | nullable                                   |
| `starts_at`   | TEXT     | ISO 8601                                   |
| `ends_at`     | TEXT     | nullable                                   |
| `city`        | TEXT     |                                            |
| `category`    | TEXT     | comedy, concert, …                         |
| `venue_json`  | TEXT     | JSON-encoded venue                         |
| `source_json` | TEXT     | JSON-encoded source `{name, url}`          |
| `price_json`  | TEXT     | nullable, JSON                             |
| `subcategories_json` | TEXT | JSON array of strings                    |
| `raw`         | TEXT     | nullable, source text snippet               |
| `first_seen_at` | TEXT   | set on first insert                        |
| `last_seen_at`  | TEXT   | bumped on every re-encounter               |

### `preferences`

Single row keyed by `scope` (`'global'` for unscoped, `'city:berlin'` or `'category:comedy'` for scoped).

| column            | type    | notes                              |
| ----------------- | ------- | ---------------------------------- |
| `scope`           | TEXT PK | `'global'` or `'<key>:<value>'`    |
| `liked_json`      | TEXT    | JSON `EventRef[]`                  |
| `disliked_json`   | TEXT    | JSON `EventRef[]`                  |
| `filters_json`    | TEXT    | JSON explicit filters              |
| `derived_traits`  | TEXT    | nullable, LLM-summarized string    |
| `updated_at`      | TEXT    |                                    |

`getPreference()` returns the merge of `'global'` plus any scoped rows that match the current query (city/category). Scoped prefs override global.

### `saved_queries`

User-defined searches. PK is the composite `(city, category)` so the same topic in the same city has exactly one persisted entry.

| column                  | type    | notes                                          |
| ----------------------- | ------- | ---------------------------------------------- |
| `city`                  | TEXT    | part of PK                                     |
| `category`              | TEXT    | part of PK                                     |
| `days`                  | INTEGER | rolling timeframe in days                      |
| `query_limit`           | INTEGER | max events returned (column avoids the `LIMIT` keyword) |
| `exclude_keywords_json` | TEXT    | JSON `string[]`; flows into `Query.filters.excludeKeywords` |
| `rank_guidance`         | TEXT    | nullable free-text, appended to the rank LLM prompt |
| `created_at`            | TEXT    | preserved across upserts                       |
| `last_searched_at`      | TEXT    | nullable; bumped by `touchSavedQuery`          |

Adapter contract (all three backends):

- `listSavedQueries()` → ordered by `lastSearchedAt DESC NULLS LAST, createdAt DESC`.
- `getSavedQuery({ city, category })`
- `upsertSavedQuery(SavedQuery)` — preserves the original `createdAt` on update.
- `deleteSavedQuery({ city, category })`
- `touchSavedQuery({ city, category })` — no-op if no row matches, so `curate()` can call it unconditionally.

### `kv`

Generic adapter-agnostic key-value table. Used by features that need persistent caches across runs (e.g. the `llmExpand` query-expansion strategy). Strings only — callers serialize their own JSON. No TTL; entries are explicitly bumped via `setKV`.

| column        | type    | notes                              |
| ------------- | ------- | ---------------------------------- |
| `key`         | TEXT PK | caller-namespaced (e.g. `qx:llmExpand:v1\|berlin\|comedy\|2026-05-01\|2026-05-15`) |
| `value`       | TEXT    | caller-defined payload             |
| `updated_at`  | TEXT    | ISO 8601, set on every `setKV`     |

Adapter contract:
- `getKV(key)` → `Promise<string \| undefined>`
- `setKV(key, value)` → `Promise<void>` (upsert)

## Schema definition

- **SQLite** ([src/adapters/storage/sqlite.js](../src/adapters/storage/sqlite.js)) — a single `SCHEMA` constant of `CREATE TABLE IF NOT EXISTS …` statements, executed on every `init()`. Idempotent: re-opening an existing db is a no-op.
- **IndexedDB** ([src/adapters/storage/indexeddb.js](../src/adapters/storage/indexeddb.js)) — DB version `1`. `onupgradeneeded` creates the four object stores (`events`, `preferences`, `kv`, `savedQueries`) if absent. Per pre-`1.0` rules: when stores change, clear the IndexedDB origin rather than bumping the version.
- **Memory** — Maps; nothing to create.

When the schema needs to change during development, edit the constants in place and recreate local databases (delete the sqlite file, clear the IndexedDB origin). No migration history.

## Clearing preferences

`clearPreference(scope?)`:

- No `scope` → wipes all preference rows (`global` and scoped).
- `{ city: 'Berlin' }` → deletes `'city:berlin'`. `'global'` and other scopes untouched.
- `{ category: 'comedy' }` → deletes `'category:comedy'`.
- `{ city, category }` → deletes the most specific scope `'city:<x>|category:<y>'`.

This does **not** delete cached events; it only resets the user's stated preferences. Events are independent because we may still want cross-session dedupe even after a preference reset.

## Why SQLite, not Postgres / files

- Self-contained, single-file, no server.
- Mirrors well to IndexedDB on the browser side.
- `better-sqlite3` is synchronous and fast; we wrap it in `async` for interface symmetry.
