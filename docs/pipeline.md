# Pipeline

The six stages and the feedback path. Each is a `Protocol` in its own module; the
orchestrator (`pipeline/orchestrator.py`) knows only the protocols. This page is
*why* each stage looks the way it does. How adapters are chosen and what runs today
is one shared pattern —
[architecture.md](architecture.md#adapters-and-extras). How to watch a
run is in [observability.md](observability.md).

## expand — `expand/`

Turn one saved query into the concrete web queries to run. The variant that makes
ChatGPT/Claude-style search feel good is **multi-query fan-out**: one LLM call
explodes the intent into complementary sub-queries, searched in parallel and fused.
The shipped fan-out is **by translation** (`LLMQueryExpander`): one `submit_queries`
call returns the query rendered in the language of the country where the results
happen, any language named or implied by the query itself, and English (deduplicated,
so "русский стендап в париже" becomes Russian + French + English). Why translation
specifically: a recurring search for events/listings is answered best in the local
tongue, but the requester often phrases it in their own — searching both surfaces
sources neither phrasing alone would. Like the other LLM call sites it uses the
submit-tool pattern (the `query_expander` role), and falls back to the original text
when the model returns nothing usable. `IdentityExpander` is the no-LLM stub that
returns the user's text unchanged — handy for tests and offline runs.

Alongside expansion, the orchestrator resolves the query's **attribute domain** —
which catalog entry (events, papers, jobs, …) governs the `attributes` keys search
extracts. The `domain_classifier` LLM role picks one catalog key from the query text
(`search/_classify.py`, submit-tool pattern, falling back to a default on a
malformed/unknown choice). It's derived once and cached on `SavedQuery.domain`, so a
recurring query classifies on its first run only; the trace groups under the expand
stage logger. Why query-derived and cached, not configured: one deployment can host
queries spanning different domains, and re-asking the model every run would be waste.

## search — `search/`

Run one expanded query against the web and extract candidate results. The approach
is a **frontier model's native web-search tool**: it fans out, reads full pages,
and returns structured results in one call — close to what makes the ChatGPT/Claude
apps good, without a full deep-research agent. Other engines (Exa, Linkup,
Perplexity, Serper — see `SearchEngineKind`) remain alternative adapters behind the
same protocol.

The orchestrator dispatches every expanded query's search at once (`asyncio.gather`,
rule 5), so an engine implements a *single* query while the fan-out lives above it.

`FrontierWebSearch` drives a narrow `WebSearchBackend` port ("find structured rows
for one query") and turns those rows into ranked `RawSearchResult`s. That port is
deliberately separate from the shared `llm` module's `LLMClient`: native web search
drives the provider's built-in web-search tool through multi-step research, a
different capability than the chat client's `complete()` / `submit()`, and keeping
it separate stops that contract leaking into dedup, rank, and feedback.

URLs are **canonicalized here, at ingestion** — the point the corpus first sees an
item — so cosmetic variants (`www.`, tracking params, fragments, trailing slashes)
collapse to one key and dedup downstream compares like with like.

Extraction is **tool-shaped, not text-parsed**: the backend offers the model a
`submit_results` function tool whose JSON schema is generated from `ExtractedResult`
and reads the typed arguments, so the row shape stays single-sourced in the Pydantic
model (the submit-tool pattern — see `llm/__init__.py`). The prompt/tool/parse
contract lives in `search/_extract.py`, dependency-free so it unit-tests without the
network. Both prompts are config: the system `[search].instructions` and the
per-query `[search].prompt` template.

The row shape is **domain-agnostic on purpose**: beyond typed fields it carries a
free-form `attributes` map (`dict[str, str]`) for facts with no dedicated column —
authors/journal for a paper, company/salary for a job, organizer for an event. But
the *allowed keys* are a closed vocabulary, not whatever the model feels like
inventing: the static catalog in `search/attributes.py` groups keys by domain, each
with a fill instruction and a UI emoji. Search offers only the keys for *this*
query's classified domain — `submit_tool` narrows the generated schema's open
`attributes` object to exactly those keys (each described by its instruction,
`additionalProperties: false`). Adding or retargeting a domain is an edit to that
catalog: a deliberate code change, since the keys are a closed set (rule 4), not
per-deployment config.

Search behaviour is tuned from config: `WebSearchTuning` maps onto the Responses
`web_search` tool (`search_context_size`, a domain allow-list) plus
`reasoning.effort` (OpenAI's `ReasoningEffort` levels); empty knobs are omitted so a
minimal config asks for the tool's defaults. Geographic bias lives on the user 
(`User.location`, a `GeoBias`) and each run
threads the requesting principal's location into the search call (no user row → no
bias).

## merge — `merge/`

Fuse the per-query result lists into one ranking with **Reciprocal Rank Fusion**:
parameter-light, no cross-engine score calibration, robust to one noisy list — the
standard choice for fan-out. Pure (no I/O). Concept:
[concepts/reciprocal-rank-fusion.md](concepts/reciprocal-rank-fusion.md).

## dedup — `dedup/`

Reconcile fresh candidates against the stored corpus, within this run and across
past sessions — the same real-world item resurfaces with different URLs, titles, and
wording each run. The design is classic **entity resolution**: canonicalize the
URL, *block* on date(±N days)+city to avoid comparing everything to everything, then
score similarity (MinHash on text + embedding cosine). Above `auto_merge_threshold`
→ merge; in the tiebreak band → ask an LLM judge; below → insert as new. A
venue+start-time match also routes to the judge regardless of text score. Concept:
[concepts/entity-resolution.md](concepts/entity-resolution.md).

Choices worth their *why*:

- **Two text signals fuse by the stronger of them** (`max`, `dedup/_match.py`):
  strong wording overlap *or* strong semantic closeness flags a likely duplicate.
  This favours recall; the tiebreak-band judge guards against a high-lexical-but-
  unrelated pair auto-merging.
- **Venue+start-time is a third, structured signal that *routes to the judge*, not
  to auto-merge.** It exists because the text signals share a blind spot — one
  real-world show listed on two ticket sites in two languages (a Russian and an
  English blurb) barely overlaps lexically and only moderately by embedding, so both
  land below the merge band even though same-venue-same-time is strong identity
  evidence. But it is evidence, not proof: a multi-room venue or a source that
  defaults missing times to a fixed slot can put two *different* shows at one
  venue+time, so auto-merging on it would corrupt the golden record. The judge
  arbitrates. A missed merge is recovered next run; a wrong one is not.
- **The judge is batched** (`dedup/_judge.py`): every pair held back in a run —
  tiebreak-band *and* venue+time — is decided in a single `submit_verdicts`
  function-tool call that returns one typed boolean per numbered pair, so
  reconciliation spends one LLM round-trip per run, not one per pair. The reply is
  parsed conservatively: a malformed payload or an omitted pair reads as distinct
  (a missed merge is cheap, a wrong one corrupts the record).
- **Within-run dedup rides the same path as cross-session,** with one wrinkle for
  the judge. A sequential triage pass settles the unambiguous candidates inline and
  upserts each as it's decided, so a later candidate's `nearest` already sees it.
  Ambiguous candidates (judge-band) are instead *held back* until one batched judge
  call resolves them all, so a later candidate cannot match a not-yet-judged one —
  acceptable because it still matches the same corpus target. An exact-URL index
  short-circuits two candidates sharing one canonical URL.
- **Survivorship is first-non-empty-wins** (plus a key-wise `attributes` merge): the
  canonical keeps a field once any source fills it, later sightings only fill gaps,
  and provenance records the raw source that won each field. No per-source trust
  scores yet, so "earliest complete sighting holds the field" is the order we can
  defend.

Dedup depends only on the read side (`SearchResultStore.nearest`, which applies the
date+city block). Thresholds live in `config.py` so eval can sweep them; the judge
is the `dedup_judge` LLM role. The prompt/parse and matching contracts live in
dependency-free helpers (`dedup/_judge.py`, `dedup/_match.py`, `dedup/_golden.py`),
unit-tested without the network.

## store — `storage/`

Persist raw candidates, golden canonical results, provenance, and per-query result
links. See [storage.md](storage.md).

## rank — `rank/`

Order the canonical results for one saved query given its preference profile. See
[preferences.md](preferences.md).

## feedback — `feedback/`

Fold a like/dislike (with optional reason) into the saved query's preference
profile. See [preferences.md](preferences.md).

## eval

Any stage — or the whole pipeline — can be scored offline against golden fixtures.
See [eval.md](eval.md).
