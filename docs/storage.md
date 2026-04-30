# Storage

## What gets stored, and why

Four logical things, each in its own table:

- **events** — the canonical record of everything curation produced. Used for cross-session lookups and for resolving feedback ids back to event detail.
- **event_states** — per-saved-query junction holding each event's lifecycle state (`Found` / `Shown` / `Liked` / `Disliked`, plus optional `reason`). Distinct from `events` on purpose: `events` is content, `event_states` is the user-visible state machine. The state values live in the [eventState enum](../src/core/eventState.js).
- **saved_queries** — user-defined searches keyed on `(city, queryText)`, plus per-query taste configuration (`excludeKeywords`, `excludeVenues`, `price`, `freeOnly`, `guidance`, `derivedTraits`, `archived`). One persisted row per `(city, queryText)` pair; editing the freeform text replaces the row in place.
- **kv** — generic adapter-agnostic key-value table for caches across runs (e.g. the `llmExpand` query-expansion strategy). Strings only; callers serialize and namespace their own keys.

Schemas are defined inline in each adapter — see [src/adapters/storage/sqlite.js](../src/adapters/storage/sqlite.js) and [src/adapters/storage/indexeddb.js](../src/adapters/storage/indexeddb.js). The full adapter contract is in [adapters.md](adapters.md).

## Why state is per-saved-query, not global

A like in Berlin/comedy shouldn't suppress the same event under Berlin/jazz. Two saved queries can legitimately want the same event for different reasons; the state machine has to be scoped to the search the user was running when they reacted to it. The composite PK on `event_states` is `(event_id, city, query_text)`.

`Found` rows are written by the pipeline after `upsertEvents`. `Shown`, `Liked`, `Disliked` are written by `recordFeedback`. Adapters never overwrite a non-`Found` row with `Found` — once a row has been seen or rated, the user signal sticks even when the same event resurfaces.

For cross-session dedupe in the dedupe stage, `getShownIds(ids, ref)` returns the subset whose state ∈ {Shown, Liked, Disliked} for the ref. Events whose only state is `Found` stay eligible to resurface, which matters for rolling timeframes — discarded results from `curate()` and events the user never paged into shouldn't disappear forever just because the pipeline saw them once.

## Why no migration system

Pre-`1.0` development. The schema is defined once per adapter and applied idempotently on `init()`. When the schema changes, edit it in place and reset local databases (delete the SQLite file, clear the IndexedDB origin). Don't add migrations, version-aware shims, or cross-version reads — they are dead weight before any user has long-lived data. The IndexedDB adapter still bumps its `onupgradeneeded` version when stores change, so legacy stores from prior layouts get dropped cleanly.

## Backend tradeoffs

| Backend     | Module                          | When to use                  |
| ----------- | ------------------------------- | ---------------------------- |
| `sqlite`    | `adapters/storage/sqlite.js`    | Node — default for CLI / scripts |
| `indexeddb` | `adapters/storage/indexeddb.js` | Browser — web-app integration |
| `memory`    | `adapters/storage/memory.js`    | Tests, ephemeral runs        |

All three implement the same `StorageAdapter` interface. SQLite was chosen over Postgres / file-per-event because it's self-contained and single-file, mirrors well to IndexedDB on the browser side (same conceptual schema, different physical store), and `better-sqlite3` is synchronous and fast (we wrap it in `async` for interface symmetry — no real I/O cost). The lib never stores anything server-side.

## A few intentional denormalizations

- `events.last_shown_at` is bumped whenever any `event_states` row transitions into `shown`/`liked`/`disliked`. It's a cached mirror of "the most recent state-transition timestamp across any saved query for this event," kept on the events table to avoid an aggregation query on every UI render.

If you find yourself adding more, weigh the read-path saving against the write-path divergence risk; the state-transition write path already has to bump it correctly in two backends.
