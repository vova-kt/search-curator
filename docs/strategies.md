# Strategies

Strategies are pluggable functions over events. Three kinds: `dedupe`, `filter`, `rank`. They live in `src/strategies/` and are passed to `createCurator` as arrays — applied in order.

## Contract

```js
/**
 * @typedef {(events: Event[], ctx: Ctx) => Promise<Event[]> | Event[]} Strategy
 */
```

A strategy is a (potentially async) function returning a (possibly mutated) event list. It must not throw on empty input. It may return fewer events (filter / dedupe) or reorder them (rank). It may *not* fabricate new events.

If a strategy needs configuration, expose a factory:

```js
export function fuzzyTitle({ threshold = 0.85 } = {}) {
  return async function fuzzyTitleStrategy(events, ctx) {
    /* ... */
  };
}
```

## Dedupe strategies

Live in `src/strategies/dedupe/`.

- **`byId`** — collapses events that share the same content-derived `id` (hash of title / startsAt / venue / city). Catches "same event extracted from multiple source pages" without falsely collapsing distinct events listed on one page. Cheapest. Always run first.
- **`fuzzyTitle`** — normalize title (lowercase, strip punctuation, collapse whitespace) and compare with same-day, same-city events; merge when similarity ≥ threshold. Similarity is `max(token-Jaccard, char-trigram-Jaccard)` so it tolerates word-order/length differences (tokens) *and* typos or short titles (trigrams). Configurable threshold.
- **`llmJudge`** — opt-in. Asks the LLM to merge a small set of borderline candidates. Only runs on pairs that survived `fuzzyTitle` but share a venue + date.

> **Why not key on `source.url`?** A listing page (one URL) often yields multiple distinct events. Keying dedupe on the source URL would collapse them. Always dedupe on content (`id`) or content-similarity (`fuzzyTitle`), never on the page where we found the listing.

Cross-session dedupe: the dedupe stage also consults `ctx.storage.getSeenIds()` and drops events already present in the store. This is a stage-level concern, not a strategy.

## Filter strategies

Live in `src/strategies/filter/`.

- **`rules`** — applies `Preference.explicitFilters` (`excludeKeywords`, `excludeVenues`, price bounds). Pure, no LLM.
- **`preferenceLLM`** — sends the candidate list plus the user's liked/disliked examples and `derivedTraits` to the LLM with the `filterByPreference` prompt; drops events the LLM judges off-target.

Order matters: cheap rule-based filters first, LLM-based last (so the LLM only sees a smaller set).

## Rank strategies

Live in `src/strategies/rank/`.

- **`byDate`** — chronological, soonest first. Always safe as a fallback.
- **`llmRank`** — sends the (post-filter) list to the LLM with the `rankByPreference` prompt; expects an ordered array of event ids.

Last strategy wins the final order. Truncation to `query.limit` happens in the pipeline after ranking.

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
