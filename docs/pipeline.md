# Pipeline

The pipeline transforms a `Query` into curated `Event[]`. It is composed of stages, each a function of `(events, ctx) => Promise<events>`.

## Context

Every stage receives a `ctx` object:

```js
ctx = {
  llm,           // LLMAdapter
  search,        // SearchAdapter[]
  storage,       // StorageAdapter
  strategies,    // { dedupe[], filter[], rank[] }
  config,        // resolved config (defaults + overrides)
  query,         // current Query
  preference,    // current Preference, loaded once at pipeline start
  signal,        // optional AbortSignal
}
```

Stages are pure with respect to `ctx` (they don't mutate it). They may emit events into `events` (the array threaded through stages).

## Stages

### 1. discover (`src/stages/discover.js`)

**In**: `ctx.query` → **Out**: `SearchHit[]` (treated as `events` with stub fields)

Composes search queries by running every strategy in `ctx.strategies.queryExpansion` (see [strategies.md](strategies.md)), lower-cases + trims for case-insensitive dedup, then fans the union out across `ctx.search` adapters. Returns deduplicated `SearchHit { url, title, snippet, source }`.

Errors:
- A single failing query-expansion strategy is warned about and skipped.
- An empty `queryExpansion` array is a misconfiguration — `discover` throws.

### 2. extract (`src/stages/extract.js`)

**In**: `SearchHit[]` → **Out**: `Event[]`

For each hit, fetch page content (or use the snippet if rich enough), pass through the LLM with the `extractEvents` prompt, parse the structured response into `Event`s. Drops hits that don't yield valid events.

### 3. dedupe (`src/stages/dedupe.js`)

**In**: `Event[]` → **Out**: `Event[]`

Runs `ctx.strategies.dedupe` in order. Each strategy is a function `(events, ctx) => Event[]` that may merge or drop duplicates. Stable order across runs: `byId` first (cheap, exact on content hash), then `fuzzyTitle`, then optional `llmJudge` for borderline cases.

Cross-session dedupe also consults `ctx.storage.getSeenIds()` to skip events already curated in past sessions (relevant for rolling timeframes).

### 4. filter (`src/stages/filter.js`)

**In**: `Event[]` → **Out**: `Event[]`

Runs `ctx.strategies.filter` in order. Strategies receive the current `ctx.preference` and may drop events. Order matters: cheap rule-based filters first (`rules`), LLM-based last (`preferenceLLM`).

### 5. rank (`src/stages/rank.js`)

**In**: `Event[]` → **Out**: `Event[]` (sorted, truncated to `ctx.query.limit`)

Runs `ctx.strategies.rank` in order. Each strategy returns a re-ordered list. Last one wins. Truncation happens at the end.

### 6. feedback (`src/stages/feedback.js`)

**In**: `{ liked: string[], disliked: string[] }`, last result set → **Out**: updated preference persisted to storage.

Not part of `curate()` — invoked via `curator.recordFeedback()`. Pulls liked/disliked events from the last result set, extracts signals (venue, subcategories, time-of-day, price band), updates `Preference.likedEvents` / `dislikedEvents`, and optionally re-derives `Preference.derivedTraits` via LLM.

## Orchestration

`src/core/pipeline.js` wires the stages:

```js
async function runCuration(ctx) {
  let events = await discover(ctx);
  events = await extract(events, ctx);
  events = await dedupe(events, ctx);
  events = await filter(events, ctx);
  events = await rank(events, ctx);
  events = events.slice(0, ctx.query.limit ?? ctx.config.pipeline.defaultLimit);
  await ctx.storage.upsertEvents(events);
  return events;
}
```

The orchestrator also marks events as seen in storage (so future runs can skip them).

## Adding a stage

If you need a new stage (e.g., `enrich` for venue lookups), add it under `src/stages/`, place it in the right position in `pipeline.js`, and document it here. There's no plugin system for stages — the pipeline shape is intentional.

## Errors

- Adapter errors propagate. The pipeline does not silently swallow.
- Strategy errors are caught per-strategy with a logged warning; the pipeline continues with the input it had. Rationale: a failing LLM-rank strategy shouldn't kill the whole curation; date-sort still gives a usable result.
- Extract errors per-hit are isolated (a single broken page doesn't fail the run).
