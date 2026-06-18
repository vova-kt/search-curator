# Pipeline

The six stages and the feedback path. Each is a `Protocol` in its own module; the
orchestrator (`pipeline/orchestrator.py`) only knows the protocols. What follows
is *why* each stage looks the way it does and what's real vs. stubbed today.

The orchestrator logs each stage under a per-stage logger
(`events_curator.stage.<name>`), milestones at `INFO` and detail at `DEBUG`, so
verbosity is tunable one stage at a time — see [deployment.md](deployment.md#logging).

## Observability — the progress stream

Logs answer *what happened* after the fact; a person watching a live run needs to
know *what it's waiting on right now*. A run can be slow (web search reads full
pages, dedup and rank may call an LLM), so `run()` takes an optional
`ProgressListener` (`pipeline/progress.py`) and notifies it as each stage advances.
The same milestones the per-stage loggers record are fanned out to the listener, so
the trace an operator sees and the trace the logs keep never drift apart — they're
emitted from one place (`_Reporter` in the orchestrator).

Each `ProgressEvent` carries the `Stage`, a `ProgressPhase`, and a ready-to-show
`detail` line. A `START` is emitted *before* a slow await so the UI can say
"Searching the web…" while it blocks; a `DONE` reports the result ("Fused into 12
candidates"). The listener is called synchronously on the run's own task in stage
order, so an implementation must stay cheap and non-blocking — no network, no
`await`. A run with no listener (scheduler, eval) skips emission entirely; the
listener is purely additive and never changes what a run computes.

The Streamlit console is the reference consumer: it wraps a run in an `st.status`
panel whose label tracks the running stage and whose body logs each event, so the
operator sees the pipeline move instead of a bare spinner.

## expand — `expand/`

Turn one saved query into the concrete web queries to run. The variant that makes
ChatGPT/Claude-style search feel good is **multi-query fan-out**: one LLM call
explodes the user's intent into several complementary sub-queries (synonyms,
neighbourhoods, date phrasings), which are then searched in parallel and fused.

Shipped today: `IdentityExpander`, a real (non-stub) singleton — it returns the
user's text unchanged. It's enough to exercise the whole pipeline; replace it
with the LLM fan-out when wiring the `llm` extra.

## search — `search/`

Run one expanded query against the web and extract candidate results. We tried
keyword/SERP APIs (Tavily, Brave) and found recall and extraction quality too
low. The chosen direction (**Variant A**) is a **frontier model's native
web-search tool**: it fans out, reads full pages, and returns structured results
in one call — much closer to what makes the ChatGPT/Claude apps good, without
building a full deep-research agent. Other engines (Exa, Linkup, Perplexity,
Serper — see `SearchEngineKind`) remain as alternative adapters behind the same
protocol.

Concurrency: the orchestrator dispatches every expanded query's search at once
(`asyncio.gather`) — this is project rule 5, and it's why an engine implements a
*single* query while the fan-out lives above it.

The engine (`FrontierWebSearch`) is real and split from the network: it drives a
narrow `WebSearchBackend` port ("find structured rows for one query") and turns
those rows into ranked `RawSearchResult`s. URLs are **canonicalized here**, at
ingestion — the point the corpus first sees an item — so cosmetic variants
(`www.`, tracking params, fragments, trailing slashes) collapse to one key and
dedup downstream compares like with like. The backend is a *dedicated* port, not
the shared `llm` module's `LLMClient`: native web search needs tool use plus
structured extraction, a different capability than `complete()`'s string-in/
string-out, and keeping it separate stops that contract from leaking into dedup,
rank, and feedback.

Shipped today: the engine plus `OpenAIWebSearch`, the concrete backend over
OpenAI's Responses web-search tool (extra `llm`, re-exported lazily from the
module door — same pattern as `SqliteStorage`). The builder's `build_search_backend`
picks `OpenAIWebSearch` when an API key is set and the `llm` extra is installed, and
`UnconfiguredWebSearch` — which raises a pointer to the extra — otherwise; so a
default, keyless run still reaches the placeholder and stops there. The prompt/parse
contract lives in `search/_extract.py`, kept dependency-free so it is unit-tested
without the network.

## merge — `merge/`

Fuse the per-query result lists into one ranking with **Reciprocal Rank Fusion**.
RRF is parameter-light, needs no score calibration across engines, and is robust
to one list being noisy — the standard choice for combining fan-out results. The
stage is pure (no I/O), so it's a real implementation, not a stub. Concept:
[concepts/reciprocal-rank-fusion.md](concepts/reciprocal-rank-fusion.md).

## dedup — `dedup/`

Reconcile fresh candidates against the stored corpus, both within this run and
across past sessions — the same real-world item resurfaces with different URLs,
titles, and wording every time the query runs. The design is classic **entity
resolution**: canonicalize the URL, *block* on date(±N days)+city to avoid
comparing everything to everything, then score similarity (MinHash on text +
embedding cosine). Above `auto_merge_threshold` → merge; in the tiebreak band →
ask an LLM judge; below → insert as new. Merged records build a **golden record**
by survivorship and keep provenance. Concept:
[concepts/entity-resolution.md](concepts/entity-resolution.md).

Two design choices worth their *why*:

- **The two signals fuse by taking the stronger of them** (`max`, in
  `dedup/_match.py`): either strong wording overlap *or* strong semantic closeness
  flags a likely duplicate. That favours recall; the tiebreak-band LLM judge is the
  guard that stops a high-lexical-but-unrelated pair from auto-merging. A wrong
  merge corrupts the golden record, so the judge's verdict is parsed
  conservatively — anything but a clear "yes" inserts new (a missed merge is
  recovered next run).
- **Within-run dedup rides the same path as cross-session.** Each new/updated
  canonical is upserted *as it is decided*, so a later candidate's `nearest`
  already sees it — no separate intra-batch pass. An exact-URL index
  short-circuits the common case of two candidates sharing one canonical URL.

Survivorship is **first-non-empty-wins** (plus a tag union): the canonical keeps a
field once any source fills it, later sightings only fill gaps, and provenance
records the raw source that won each field. (No per-source trust scores yet, so
"earliest complete sighting holds the field" is the order we can defend.)

The cross-session lookup is the store's `nearest` (date+city window), so dedup
depends only on the `SearchResultStore` read side. Thresholds live in `config.py`, not
as literals, so eval can sweep them. The judge's model, temperature, and system
prompt are the `dedup_judge` LLM role, defined under `[llm.roles.dedup_judge]` in
config and passed in per `complete()` call, so the deduper holds no model state of
its own — see [deployment.md](deployment.md#configuration).

Shipped today: `ThresholdDeduper` is real — blocking + two-threshold similarity +
the survivorship/provenance logic all run without any extra. It drives an
`Embedder` (semantic signal) and an `LLMClient` (the judge) that the builder picks
via `build_embedder` / `build_llm`: the judge is `OpenAIChat` once a key + the `llm`
extra are present, and the embedder defaults to the local bge-small `BgeEmbedder`
(extra `embed`) with `OpenAIEmbedder` as the API alternative — falling back to an
Unconfigured placeholder only when the chosen backend isn't installed/keyed. The
prompt/parse and matching contracts live in
dependency-free helpers (`dedup/_judge.py`, `dedup/_match.py`, `dedup/_golden.py`),
unit-tested without the network.

## store — `storage/`

Persist raw candidates, the golden canonical results, provenance, and the
per-query result links. Covered in [storage.md](storage.md).

## rank — `rank/`

Order the canonical results for one saved query given its preference profile.
Covered in [preferences.md](preferences.md).

## feedback — `feedback/`

Fold a like/dislike (with optional reason) into the saved query's preference
profile. Also covered in [preferences.md](preferences.md).

## Eval

Any stage — or the whole pipeline — can be scored offline against golden
fixtures through one harness. See [eval.md](eval.md).
