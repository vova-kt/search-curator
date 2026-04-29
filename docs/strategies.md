# Strategies

Strategies are pluggable functions. Three kinds: `queryExpansion`, `dedupe`, `rank`. They live in `src/strategies/` and are passed to `createCurator` as arrays — applied in order. (There is no separate `filter` kind; rule-based excludes and LLM-based soft filtering are both rank strategies, since the filter stage was folded into rank.)

## Contracts

Event strategies (dedupe / rank):

```js
/**
 * @typedef {(events: Event[], ctx: Ctx) => Promise<Event[]> | Event[]} Strategy
 */
```

Query-expansion strategies are different — they produce search queries from `ctx.query`, not events:

```js
/**
 * @typedef {(ctx: Ctx) => Promise<string[]> | string[]} QueryExpansionStrategy
 */
```

An event strategy is a (potentially async) function returning a (possibly mutated) event list. It must not throw on empty input. It may return fewer events (dedupe, or rank strategies like `rules` / `llmRank`) or reorder them (rank strategies like `byDate` / `llmRank`). It may *not* fabricate new events.

A query-expansion strategy returns search-query strings. The discover stage runs all configured strategies in order, lower-cases + trims for dedup, and fans the union out across search adapters. A single strategy that throws is logged and skipped — others continue. If the strategy *array* is empty, `discover` throws (misconfiguration).

If a strategy needs configuration, expose a factory:

```js
export function fuzzyTitle({ threshold = 0.85 } = {}) {
  return async function fuzzyTitleStrategy(events, ctx) {
    /* ... */
  };
}
```

## Query-expansion strategies

Live in `src/strategies/queryExpansion/`.

- **`templates()`** — deterministic, zero-LLM. Returns four phrasings of the user's freeform `queryText`: `"<queryText> events in <city>"`, `"upcoming <queryText> <city>"`, `"<queryText> schedule <city>"`, `"<queryText> <city> this month"`. Cheap, safe fallback, useful in tests.
- **`llmExpand({ limit } = {})`** — opt-in by default. One LLM call (`expandQueriesPrompt`) takes the user's freeform `queryText` and produces a diverse list mixing synonyms / sub-genres, local-language variants, and timeframe-specific phrasings derived from the resolved `from`–`to` window. `limit` defaults to `ctx.config.queryExpansion.defaultLimit` — see [src/core/config.js](../src/core/config.js) for the value. Results are persisted in storage KV under key `qx:llmExpand:v2|<city>|<queryText>|<from>|<to>` so the same `(city, queryText, timeframe)` triple skips the LLM on repeat. The `:v2` suffix lets us bust the cache by bumping the version when the prompt or key shape materially changes.

  Failure semantics:
  - In `config.dev` mode, the underlying error (network, malformed JSON, no `queries` field, empty result) is re-thrown.
  - Otherwise, a `console.warn` is logged and the strategy falls back to the result of `templates()` so the pipeline still has queries to run.

The default in `createCurator` is `[llmExpand(), templates()]` — both run, deduped — so prod-mode users get LLM-driven recall plus a non-LLM safety net even if `llmExpand` falls back to templates internally (the duplicates are dropped at the dedupe step).

## Dedupe strategies

Live in `src/strategies/dedupe/`.

- **`byId`** — collapses events that share the same content-derived `id` (hash of title / startsAt / venue / city). Catches "same event extracted from multiple source pages" without falsely collapsing distinct events listed on one page. Cheapest. Always run first.
- **`fuzzyTitle`** — normalize title (lowercase, strip punctuation, collapse whitespace) and compare with same-day, same-city events; merge when similarity ≥ threshold. Similarity is `max(token-Jaccard, char-trigram-Jaccard)` so it tolerates word-order/length differences (tokens) *and* typos or short titles (trigrams). Configurable threshold.
- **`llmJudge`** — opt-in. Asks the LLM to merge a small set of borderline candidates. Only runs on pairs that survived `fuzzyTitle` but share a venue + date.

> **Why not key on `source.url`?** A listing page (one URL) often yields multiple distinct events. Keying dedupe on the source URL would collapse them. Always dedupe on content (`id`) or content-similarity (`fuzzyTitle`), never on the page where we found the listing.

Cross-session dedupe: the dedupe stage also consults `ctx.storage.getShownIds()` and drops events the user has already been shown (recorded via `curator.markShown(...)`). Events that landed in storage but were never marked shown remain eligible to resurface. This is a stage-level concern, not a strategy.

## Rank strategies

Live in `src/strategies/rank/`. Rank strategies may both **drop** events and **reorder** them — there is no separate filter stage.

- **`rules`** — applies `Preference.explicitFilters` (`excludeKeywords`, `excludeVenues`, price bounds) plus any `Query.filters` overrides. Drops events; preserves order. Pure, no LLM.
  - Keyword matching is morphology-aware via [Snowball](http://snowball.tartarus.org/) stemming: title and description are tokenized on Unicode letters and each token is stemmed (Cyrillic → `russian`, otherwise → `english`); keywords are stemmed the same way and matched as space-bounded substrings of the stemmed haystack. So `excludeKeywords: ['концерт']` drops `'концерта'` / `'концертов'` / `'на концерте'`, and `['show']` drops `'shows'` / `'showing'`. Multi-word keywords (e.g. `'open mic'`) match contiguously after stemming.
  - Venue matching stays exact (post-`normalize`) — proper nouns shouldn't be stemmed.
- **`byDate`** — reorders chronologically, soonest first. Always safe as a fallback.
- **`llmRank`** — combined filter + rank in one LLM call. Sends the input list (typically post-`rules`) to the LLM with the `rankByPreference` prompt, along with the user's original query (`city` + `queryText`), liked / disliked examples, `derivedTraits`, and any `Query.guidance` natural-language free-text. The original `queryText` is the primary on-topic filter — the LLM uses it to drop off-topic events that snuck through extraction. The `guidance` field carries additional refinement: both filter intent (which events to omit) and rank intent (how to order what remains). Disliked examples may carry an optional `reason` from the user (see [preferences.md](preferences.md)); the prompt instructs the model to apply that stated principle generally to candidates rather than only to literal lookalikes. The model is instructed to omit poor matches and return the kept events ordered by likely interest, each annotated with an ~5-word `rationale` exposed on `Event.rationale`.
  - Skipped when there are no liked/disliked examples, no `derivedTraits`, and no `guidance` — there's nothing for the model to act on.
  - Safety net: if the response is empty/malformed, falls back to the input list in original order rather than collapsing the result set to nothing.

The default chain in `createCurator` is `[rules, byDate]`; the example TUI opts into `[rules, llmRank]`. Strategies run in array order; the last one that returns wins the final list. Truncation to `query.limit` happens in the pipeline orchestrator after the rank stage returns.

## Adding a strategy

1. Add a file under `src/strategies/<kind>/<name>.js`.
2. Export either a strategy function directly or a factory that returns one.
3. Re-export it from `src/strategies/<kind>/index.js`.
4. Document it in this file under the right kind.
5. Add a unit test under `test/strategies/`.

## Composability

Strategies are simple enough to compose ad-hoc:

```js
const myDedupe = async (events, ctx) => {
  const a = await byId(events, ctx);
  const b = await fuzzyTitle({ threshold: 0.9 })(a, ctx);
  return b;
};
```

But the curator already takes an array, so prefer that:

```js
strategies: { dedupe: [byId, fuzzyTitle({ threshold: 0.9 })] }
```
