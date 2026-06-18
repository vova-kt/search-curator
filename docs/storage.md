# Storage

Ports live in `storage/protocols.py`; the dependency-free default is
`InMemoryStorage` (`storage/memory.py`). The production adapter is `SqliteStorage`
(SQLite + `sqlite-vec`, extra `store`, in `storage/sqlite.py`), behind the same
`Storage` facade and re-exported lazily from the module door (see
[architecture.md](architecture.md#adapters-and-extras)).

## Why SQLite, not Postgres

The target is a single NUC serving one operator's recurring searches; the corpus is
small (thousands, not millions, of results). SQLite is a single file — trivial to
back up, to mount into both the server and the Streamlit view, and to reset.
`sqlite-vec` keeps the embedding index *in the same file*, so there's no second
service for vector search. At this scale a brute-force flat cosine scan is fine —
exactly what the in-memory store does too, so the two behave identically.

## Golden records and provenance

Dedup (see [pipeline.md](pipeline.md)) collapses many raw sightings of one
real-world item into a single **canonical** record built by survivorship. A
`Provenance` records which raw source won each field, so a surprising title or price
can be traced back. Raw results are never discarded; the canonical references them by
id.

## The facade

`Storage` is split into small per-aggregate stores (users, queries, results,
feedback, preferences) rather than one fat object, so a stage depends only on the
slice it needs — dedup takes a `SearchResultStore`, feedback a `FeedbackStore` +
`PreferenceStore`. The cross-session dedup query is `SearchResultStore.nearest`,
which applies the date+city block before scoring. Ownership is enforced a layer up
([auth.md](auth.md)); storage just keys rows by `UserId` / `SavedQueryId`.

## The per-user delivery ledger

`SearchResultStore` also keeps a **shown ledger**: which canonical results a given
user has already been delivered. It is keyed by `UserId`, not `SavedQueryId`, on
purpose — the bot's "don't repeat" guarantee is that a result a user has seen is
never sent again *even through a different saved query* (see
[telegram.md](telegram.md)). `mark_shown` records a delivery and `shown_ids_for_user`
reads it back; `mark_shown` is idempotent, so re-delivering the same id is a no-op
rather than a duplicate row. The pipeline consults it via `run(..., unseen_only=True)`,
which subtracts the ledger before ranking.

`SavedQueryStore.delete` removes a query; the SQLite adapter also clears its
result links (the ledger is per-user and outlives any one query, so it is left
intact).

## SQLite row layout

Each aggregate stores its full pydantic model as a JSON `data` column, so
round-tripping stays faithful and survives model changes without per-column
migrations. The columns *beside* `data` exist only to filter or sort — ownership and
schedule flags, the normalized city and `starts_at` epoch that form the dedup block
— or to hold vectors as float32 blobs, kept out of `data` to avoid storing them
twice and re-attached on read. `nearest` runs the date+city block as a plain
`WHERE`, then scores survivors with a flat `vec_distance_cosine` scan and returns
cosine *similarity* (`1 − distance`) — the same ordering `InMemoryStorage` produces.
`SqliteStorage` owns one connection: `init()` opens it, loads the extension, applies
the schema; `close()` releases it.

## In-memory default

`InMemoryStorage` is a real implementation (plain dicts + pure-Python cosine and
date/city blocking), not a mock — the reference for what the SQLite adapter must
reproduce. The wiring helper `build_storage` (`pipeline/builder.py`) is the single
place that turns config into a store: `STORAGE__DB_PATH=:memory:` selects
`InMemoryStorage`, any other path selects `SqliteStorage` (imported lazily). Every UI
calls it, so they all agree on the same backing store.
