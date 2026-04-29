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
- **IndexedDB** ([src/adapters/storage/indexeddb.js](../src/adapters/storage/indexeddb.js)) — DB version `1`. `onupgradeneeded` creates the three object stores if absent.
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
