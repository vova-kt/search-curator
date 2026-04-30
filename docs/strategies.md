# Strategies

Strategies are pluggable functions. Three kinds: `queryExpansion`, `dedupe`, `rank`. They live in [src/strategies/](../src/strategies/) and are passed to `createCurator` as arrays — applied in order. There is no separate `filter` kind; rule-based excludes and LLM-based soft filtering are both rank strategies, since the filter stage was folded into rank (see [pipeline.md](pipeline.md)).

## Why arrays of pure functions

Pluggability without a plugin system. The pipeline stage doesn't know how many strategies are in its slot or what they do — it just iterates. That makes it trivial to compose ad-hoc chains, drop in a custom strategy for one curation, or fold an existing strategy out of the default. The chain is also stable across runs (deterministic order), which matters for debuggability.

Event strategies (`dedupe` / `rank`) are `(events, ctx) => Promise<Event[]> | Event[]` — they may drop or reorder, may not fabricate. Query-expansion strategies are different: `(ctx) => Promise<string[]> | string[]` — they produce search queries from `ctx.query`, not events. Type definitions live in [src/core/types.js](../src/core/types.js).

A strategy that needs configuration exposes a factory:

```js
export function fuzzyTitle({ threshold = 0.85 } = {}) {
  return async function fuzzyTitleStrategy(events, ctx) { /* ... */ };
}
```

## Query-expansion

[src/strategies/queryExpansion/](../src/strategies/queryExpansion/). The discover stage runs all configured strategies concurrently, lower-cases + trims for case-insensitive dedup, and fans the union out across search adapters. A single strategy that throws is logged and skipped; others continue. An empty strategy *array* is a misconfiguration and `discover` throws.

Default in `createCurator`: `[llmExpand(), templates()]` — both run, deduped — so prod-mode users get LLM-driven recall plus a non-LLM safety net.

- **`templates()`** — deterministic, zero-LLM. Returns four phrasings of the user's freeform query (event listing variants in the city, upcoming/schedule/this-month variants). Cheap, safe fallback, useful in tests.
- **`llmExpand({ limit } = {})`** — one LLM call (`expandQueriesPrompt`) producing diverse queries: synonyms / sub-genres, local-language variants, timeframe-specific phrasings derived from the resolved `from`–`to` window. `limit` defaults to `config.queryExpansion.defaultLimit`. Results are persisted in storage `kv` under key `qx:llmExpand:v2|<city>|<queryText>|<from>|<to>` so the same triple skips the LLM on repeat. The `:v2` suffix lets us bust the cache by bumping the version when the prompt or key shape changes.

  Failure semantics: in `config.dev` mode the underlying error re-throws; otherwise a warn is logged and the strategy falls back to `templates()` so the pipeline still has queries to run.

## Dedupe

[src/strategies/dedupe/](../src/strategies/dedupe/). Stable order across runs: cheap, exact strategies first; LLM-backed last.

- **`byId`** — collapses events sharing the same content-derived `id` (hash of title / startsAt / venue / city). Catches "same event extracted from multiple source pages" without falsely collapsing distinct events listed on one page. Cheapest. Always run first.
- **`fuzzyTitle`** — normalizes title (lowercase, strip punctuation, collapse whitespace) and compares same-day, same-city events; merges when similarity ≥ threshold. Similarity is `max(token-Jaccard, char-trigram-Jaccard)` — tolerates word-order/length differences (tokens) *and* typos or short titles (trigrams). Threshold configurable.
- **`llmJudge`** — opt-in. Asks the LLM to merge a small set of borderline candidates. Only runs on pairs that survived `fuzzyTitle` but share a venue + date.

> **Why not key on `source.url`?** A listing page (one URL) often yields multiple distinct events. Keying dedupe on the source URL would collapse them. Always dedupe on content (`id`) or content-similarity (`fuzzyTitle`), never on the page where we found the listing.

### Cross-session dedupe is stage-level, not a strategy

The dedupe stage *also* consults `ctx.storage.getShownIds(ids, ref)` and drops events the user has already been shown for the **same saved query**. Per-ref so a like in Berlin/comedy doesn't suppress the same event under Berlin/jazz. An event whose only `event_states` row is `Found` (pipeline saw it but the user never did) stays eligible to resurface. This is a stage concern — it touches storage and is shared by every dedupe-strategy chain — so it doesn't live in a strategy.

## Rank

[src/strategies/rank/](../src/strategies/rank/). Rank strategies may both **drop** events and **reorder** them — there is no separate filter stage. Strategies run in array order; the last one wins the final list. Truncation to `query.limit` happens in the pipeline orchestrator after the stage returns; rank itself never truncates.

Default in `createCurator`: `[rules, byDate]`. The example TUI opts into `[rules, llmRank]` so saved-query guidance and rationales actually flow through.

- **`rules`** — reads `excludeKeywords`, `excludeVenues`, `price`, `freeOnly` from `ctx.query.savedQuery` (auto-loaded by `curate()` if a matching saved query exists). Drops events; preserves order. Pure, no LLM.

  Keyword matching is morphology-aware via [Snowball](http://snowball.tartarus.org/) stemming: title and description are tokenized on Unicode letters and each token is stemmed (Cyrillic → `russian`, otherwise → `english`); keywords are stemmed the same way and matched as space-bounded substrings of the stemmed haystack. So `excludeKeywords: ['концерт']` drops `'концерта'` / `'концертов'` / `'на концерте'`, and `['show']` drops `'shows'` / `'showing'`. Multi-word keywords (`'open mic'`) match contiguously after stemming. Venue matching stays exact (post-`normalize`) — proper nouns shouldn't be stemmed.

- **`byDate`** — reorders chronologically, soonest first. Always safe as a fallback.

- **`llmRank`** — combined filter + rank in one LLM call. Sends the input list (typically post-`rules`) to the `rankByPreference` prompt along with the user's original `(city, queryText)`, liked / disliked examples (loaded via `ctx.storage.getEventStates(ref)`), `ctx.query.savedQuery.derivedTraits`, and any `Query.guidance` natural-language free-text. The original `queryText` is the primary on-topic filter — the LLM uses it to drop off-topic events that snuck through extraction. The `guidance` field carries additional refinement: both filter intent (which events to omit) and rank intent (how to order what remains). Disliked examples may carry an optional `reason` (see [preferences.md](preferences.md)); the prompt instructs the model to apply that stated principle generally rather than only to literal lookalikes. The model is instructed to omit poor matches and return the kept events ordered by likely interest, each annotated with an ~5-word `rationale` exposed on `Event.rationale`.

  Skipped when there are no liked/disliked examples, no `derivedTraits`, and no `guidance` — there's nothing for the model to act on. Safety net: if the response is empty/malformed, falls back to the input list in original order rather than collapsing the result set to nothing.

## Adding a strategy

1. Add a file under `src/strategies/<kind>/<name>.js`. Export either a function directly or a factory that returns one.
2. Re-export it from `src/strategies/<kind>/index.js`.
3. If it has notable tradeoffs (LLM cost, ordering invariants, failure modes), describe them on this page in the relevant section.
4. Add a unit test under `test/strategies/`.

Composability is implicit — the curator already takes an array, so prefer that over building a one-off chain inside a single strategy function.
