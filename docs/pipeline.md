# Pipeline

The six stages and the feedback path. Each is a `Protocol` in its own module; the
orchestrator (`pipeline/orchestrator.py`) only knows the protocols. What follows
is *why* each stage looks the way it does and what's real vs. stubbed today.

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
module door — same pattern as `SqliteStorage`). The default backend wired by the
builder is `UnconfiguredWebSearch`, which raises until the extra is installed and
a real backend is swapped in. The prompt/parse contract lives in `search/
_extract.py`, kept dependency-free so it is unit-tested without the network.

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

The cross-session lookup is the store's `nearest` (date+city window), so dedup
depends only on the `SearchResultStore` read side. Thresholds live in `config.py`, not
as literals, so eval can sweep them.

Shipped today: `ThresholdDeduper` stub (raises). Needs the `embed` + `llm` extras.

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
