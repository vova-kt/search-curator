# Storage

Ports live in `storage/protocols.py`; the dependency-free default is
`storage/memory.py`. The production adapter is SQLite + `sqlite-vec` (extra
`store`) behind the same `Storage` facade.

## Why SQLite, not Postgres

The target is a single Intel NUC serving one operator's recurring searches. The
corpus is small (thousands, not millions, of results). SQLite is a single file —
trivial to back up, to mount into both the server and the Streamlit view, and to
reset (there are no migrations pre-`1.0`; when the schema changes, delete the
file). `sqlite-vec` keeps the embedding index *in the same file*, so there's no
second service to run for vector search. At this scale a brute-force flat cosine
scan is fine — which is exactly what the in-memory store does too, so the two
implementations behave identically.

## One DB, many users

The DB is multi-user by design: every saved query is owned by one user, and the
store never assumes a single caller. Identity and ownership are enforced a layer
up (see [auth.md](auth.md)); storage just keys rows by `UserId` / `SavedQueryId`.

## Golden records and provenance

Dedup (see [pipeline.md](pipeline.md)) collapses many raw sightings of one
real-world item into a single **canonical** record built by survivorship — each
field's value is taken from the most trustworthy source. `Provenance` records
which raw source won each field, so a surprising title or price can always be
traced back. Raw results are never discarded; the canonical record references them
by id.

## The facade

`Storage` is split into small per-aggregate stores (users, queries, results,
feedback, preferences) rather than one fat object, so a stage depends only on the
slice it needs — dedup takes a `SearchResultStore`, feedback takes a `FeedbackStore` +
`PreferenceStore`. The cross-session dedup query is `SearchResultStore.nearest`, which
applies the date+city block before scoring; see the protocol for its shape.

## In-memory default

`InMemoryStorage` is a real implementation (plain dicts + pure-Python cosine and
date/city blocking), not a mock. Tests and eval run against it with no native
dependencies, and it's the reference for what the SQLite adapter must reproduce.
