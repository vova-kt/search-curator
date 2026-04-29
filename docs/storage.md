# Storage

Storage holds four things: **events** (the canonical record produced by curation, used for cross-session lookups and feedback resolution), an **event_states** junction recording per-saved-query state for each event (Found / Shown / Liked / Disliked, with optional `reason`), **saved_queries** (user-defined searches, including taste configuration like `excludeKeywords`, `derivedTraits`, `archived`), and a **generic kv** table for adapter-agnostic caches (e.g. query-expansion).

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
| `venue_json`  | TEXT     | JSON-encoded venue                         |
| `source_json` | TEXT     | JSON-encoded source `{name, url}`          |
| `price_json`  | TEXT     | nullable, JSON                             |
| `first_seen_at` | TEXT   | set on first insert                        |
| `last_seen_at`  | TEXT   | bumped on every re-encounter               |
| `last_shown_at` | TEXT   | nullable; bumped when an `event_states` row transitions into `shown`/`liked`/`disliked` for any saved query — denormalized mirror for fast UI rendering |

### `event_states`

Per-saved-query junction holding the lifecycle state of each event for each `(city, queryText)` it has appeared under. Distinct from the `events` table: `events` is content; `event_states` is the user-visible state machine. The state values are defined in [src/core/eventState.js](../src/core/eventState.js).

| column        | type    | notes                                                         |
| ------------- | ------- | ------------------------------------------------------------- |
| `event_id`    | TEXT    | part of PK; FK-shaped pointer into `events.id`                |
| `city`        | TEXT    | part of PK; saved-query city                                  |
| `query_text`  | TEXT    | part of PK; saved-query text                                  |
| `state`       | TEXT    | one of the `EventState` enum values                           |
| `reason`      | TEXT    | nullable; user-supplied note (only meaningful for `disliked`) |
| `state_at`    | TEXT    | ISO 8601; bumped on every state transition                    |

`Found` rows are written by the pipeline after `upsertEvents`. `Shown`, `Liked`, `Disliked` are written by `recordFeedback`. Adapters never overwrite a non-`Found` row with `Found` — once a row has been seen or rated, the user signal sticks even when the same event resurfaces.

Adapter contract:
- `recordEventStates(items: Array<{ eventId, state, reason? }>, ref: { city, queryText })` — upsert one row per id (state/reason/state_at overwrite, except `Found` never replaces a non-`Found` row).
- `getEventStates(ref) => Promise<EventStateRecord[]>` — joins `event_states` to `events`, all states, ordered `state_at DESC`.
- `getShownIds(ids: string[], ref) => Promise<Set<string>>` — subset of `ids` whose state ∈ {Shown, Liked, Disliked} for the given ref. Powers per-saved-query cross-session dedupe in the dedupe stage.
- `listShown(ref, { limit? }) => Promise<Event[]>` — same filter as `getShownIds` but returns events ordered by `state_at DESC`. Powers the TUI history view.

### `saved_queries`

User-defined searches. PK is the composite `(city, query_text)` so the same query in the same city has exactly one persisted entry. Editing the freeform query text replaces the saved row in place.

| column                  | type    | notes                                                           |
| ----------------------- | ------- | --------------------------------------------------------------- |
| `city`                  | TEXT    | part of PK                                                      |
| `query_text`            | TEXT    | part of PK; user's freeform query                               |
| `days`                  | INTEGER | rolling timeframe in days                                       |
| `query_limit`           | INTEGER | max events returned (column avoids the `LIMIT` keyword)         |
| `exclude_keywords_json` | TEXT    | JSON `string[]`                                                 |
| `exclude_venues_json`   | TEXT    | JSON `string[]`                                                 |
| `price_json`            | TEXT    | nullable; JSON `{ min?, max?, currency? }`                      |
| `free_only`             | INTEGER | 0/1 boolean                                                     |
| `guidance`              | TEXT    | nullable free-text — appended to the rank LLM prompt            |
| `derived_traits`        | TEXT    | nullable; LLM-summarized taste profile (see [preferences.md](preferences.md)) |
| `archived`              | INTEGER | 0/1 boolean — soft delete; hidden from `listSavedQueries` by default |
| `created_at`            | TEXT    | preserved across upserts                                        |
| `updated_at`            | TEXT    | bumped on every upsert                                          |
| `last_searched_at`      | TEXT    | nullable; bumped by `touchSavedQuery`                           |

Adapter contract (all three backends):

- `listSavedQueries({ includeArchived? }?)` → ordered by `lastSearchedAt DESC NULLS LAST, createdAt DESC`. Default hides rows where `archived = 1`; pass `{ includeArchived: true }` to surface them.
- `getSavedQuery({ city, queryText })`
- `upsertSavedQuery(SavedQuery)` — preserves the original `createdAt` on update.
- `deleteSavedQuery({ city, queryText })`
- `touchSavedQuery({ city, queryText })` — no-op if no row matches, so `curate()` can call it unconditionally.

### `kv`

Generic adapter-agnostic key-value table. Used by features that need persistent caches across runs (e.g. the `llmExpand` query-expansion strategy). Strings only — callers serialize their own JSON. No TTL; entries are explicitly bumped via `setKV`.

| column        | type    | notes                              |
| ------------- | ------- | ---------------------------------- |
| `key`         | TEXT PK | caller-namespaced (e.g. `qx:llmExpand:v2\|berlin\|indie live music\|2026-05-01\|2026-05-15`) |
| `value`       | TEXT    | caller-defined payload             |
| `updated_at`  | TEXT    | ISO 8601, set on every `setKV`     |

Adapter contract:
- `getKV(key)` → `Promise<string \| undefined>`
- `setKV(key, value)` → `Promise<void>` (upsert)

## Schema definition

- **SQLite** ([src/adapters/storage/sqlite.js](../src/adapters/storage/sqlite.js)) — a single `SCHEMA` constant of `CREATE TABLE IF NOT EXISTS …` statements, executed on every `init()`. Idempotent: re-opening an existing db is a no-op.
- **IndexedDB** ([src/adapters/storage/indexeddb.js](../src/adapters/storage/indexeddb.js)) — `onupgradeneeded` creates the four object stores (`events`, `eventStates`, `kv`, `savedQueries`) if absent and adds the `eventStates` indexes (`eventId`, and the composite `cityQueryStateAt`). The version is bumped when stores change so legacy stores from prior versions can be dropped in `onupgradeneeded`.
- **Memory** — Maps; nothing to create.

When the schema needs to change during development, edit the constants in place and recreate local databases (delete the sqlite file, clear the IndexedDB origin). No migration history.

## Why SQLite, not Postgres / files

- Self-contained, single-file, no server.
- Mirrors well to IndexedDB on the browser side.
- `better-sqlite3` is synchronous and fast; we wrap it in `async` for interface symmetry.
