# Pipeline

The pipeline transforms a `Query` into curated `Event[]`. It is composed of stages, each a function of `(events, ctx) => Promise<events>`.

Tunables referenced below (`pipeline.extractBatchTokenCap`, `pipeline.charsPerToken`, `pipeline.extractConcurrency`, `pipeline.defaultLimit`, etc.) are defined with their defaults and per-key documentation in [src/core/config.js](../src/core/config.js) — that file is the source of truth.

## Context

Every stage receives a `ctx` object:

```js
ctx = {
  llm,           // LLMAdapter
  search,        // SearchAdapter[]
  storage,       // StorageAdapter
  strategies,    // { queryExpansion[], dedupe[], rank[] }
  config,        // resolved config (defaults + overrides)
  query,         // current Query (with `savedQuery` auto-attached if a matching SavedQuery exists)
  signal,        // optional AbortSignal
  logger,        // levelled logger built from config.logging.level
}
```

Stages are pure with respect to `ctx` (they don't mutate it). They may emit events into `events` (the array threaded through stages).

## Stages

### 1. discover (`src/stages/discover.js`)

**In**: `ctx.query` → **Out**: `SearchHit[]` (treated as `events` with stub fields)

Composes search queries by running every strategy in `ctx.strategies.queryExpansion` (see [strategies.md](strategies.md)) **concurrently** (`Promise.allSettled`), lower-cases + trims for case-insensitive dedup, then fans the union out across `ctx.search` adapters **in parallel** — every `(adapter, query)` pair is dispatched at once via `Promise.all`. Returns deduplicated `SearchHit { url, title, snippet, source }`. Hit dedup keys on a canonical form of the URL — lowercased scheme+host, `www.` stripped, fragment removed, tracking params (`utm_*`, `fbclid`, `gclid`, `mc_cid`, `ref`, etc.) dropped, trailing slash trimmed — so adapters returning the same page with different tracking suffixes collapse to one hit. Progress ticks fire as each call settles, so `current` reflects completions, not dispatch order.

Errors:
- A single failing query-expansion strategy is warned about and skipped (the rejected entry is filtered out of the `allSettled` results).
- A single failing `(adapter, query)` search is caught inside the per-task IIFE and contributes an empty hit list, so the rest of the fan-out is unaffected.
- An empty `queryExpansion` array is a misconfiguration — `discover` throws.

### 2. extract (`src/stages/extract.js`)

**In**: `SearchHit[]` → **Out**: `Event[]`

Hits are grouped into batches whose combined estimated input tokens stay within `pipeline.extractBatchTokenCap` (tokens estimated as `ceil(chars / pipeline.charsPerToken)`). Each batch is sent in a single `extractEvents` LLM call. Each page in the batch is labelled with `SOURCE_NAME` (the search adapter id) and `SOURCE_URL`; the LLM is required to echo both back inside `event.source` for every event it yields. The stage drops events missing `source.name`/`source.url` (or any other required field) and stamps `source.fetchedAt` with the current time in JS — no per-event mapping or cross-check is done. Batches run through a worker pool sized by `pipeline.extractConcurrency`; a single batch failure is logged and isolated. Progress ticks are emitted per hit (a batch advances `current` by its hit count when it settles), so the original `total: hits.length` contract is preserved.

### 3. dedupe (`src/stages/dedupe.js`)

**In**: `Event[]` → **Out**: `Event[]`

Runs `ctx.strategies.dedupe` in order. Each strategy is a function `(events, ctx) => Event[]` that may merge or drop duplicates. Stable order across runs: `byId` first (cheap, exact on content hash), then `fuzzyTitle`, then optional `llmJudge` for borderline cases.

Cross-session dedupe also consults `ctx.storage.getShownIds(ids, { city, queryText })` to skip events the user has already been shown for the same saved query in past sessions (relevant for rolling timeframes). "Shown" is distinct from "stored": every event written by the pipeline gets a `Found` row in `event_states` (so `getEvents()` and feedback can resolve them), but `getShownIds` returns only ids whose state ∈ {Shown, Liked, Disliked} for the given ref. Recording happens via `curator.recordFeedback({ ids, state, ref })`. Discarded results from `curate()` and events that were never paged into in the UI stay eligible to resurface later. The set is per-ref so a like in Berlin/comedy doesn't suppress the same event under Berlin/jazz.

### 4. rank (`src/stages/rank.js`)

**In**: `Event[]` → **Out**: `Event[]` (filtered + sorted)

Runs `ctx.strategies.rank` in order — there is no separate filter stage. Strategies may both drop events and reorder them, reading taste configuration from `ctx.query.savedQuery` and prior signal from `ctx.storage.getEventStates(ref)` as needed. Last one wins. The rank stage itself does not truncate — the orchestrator slices to `ctx.query.limit ?? ctx.config.pipeline.defaultLimit` after rank returns.

The default rank chain in `createCurator` is `[rules, byDate]`: `rules` applies hard rule-based excludes (`excludeKeywords`, `excludeVenues`, price bounds, `freeOnly`) read from `ctx.query.savedQuery`, then `byDate` orders chronologically. The example TUI opts into `[rules, llmRank]`: `rules` strips hard excludes first, then `llmRank` runs as a combined filter + rank LLM pass — events it judges to be poor matches against the user's prior likes/dislikes and `Query.guidance` are omitted from the output (so the rank stage may shrink the list), and each kept event carries an ~5-word `rationale`.

### 5. feedback (`src/stages/feedback.js`)

**In**: `FeedbackInput = { ids, state, reasons?, ref }` → **Out**: state rows persisted to storage; `SavedQuery.derivedTraits` optionally refreshed.

Not part of `curate()` — invoked via `curator.recordFeedback()`. One state per call (split likes and dislikes into two calls). Writes `event_states` rows via `recordEventStates`. When `state ∈ {LIKED, DISLIKED}` and `config.preferences.deriveTraits === true`, counts the saved query's LIKED + DISLIKED rows; if the count meets `config.preferences.traitsRefreshThreshold`, runs `derivePreferenceTraits` and persists the result onto the matching `SavedQuery.derivedTraits`.

## Orchestration

`src/core/pipeline.js` wires the stages:

```js
async function runCuration(ctx) {
  const hits = await discover(ctx);            // discover emits 'queries' + 'search' itself
  let events = await extract(hits, ctx);       // orchestrator emits extract start/done; stage emits ticks
  events = await dedupe(events, ctx);          // orchestrator emits dedupe start/done
  events = await rank(events, ctx);            // orchestrator emits rank start/done — strategies drop + reorder
  events = events.slice(0, ctx.query.limit ?? ctx.config.pipeline.defaultLimit);
  if (events.length > 0) {
    await ctx.storage.upsertEvents(events);
    // Record Found rows for this saved-query ref. recordEventStates never
    // overwrites a non-Found row, so prior Shown/Liked/Disliked sticks.
    await ctx.storage.recordEventStates(
      events.map((e) => ({ eventId: e.id, state: 'found' })),
      { city: ctx.query.city, queryText: ctx.query.queryText },
    );
  }
  return events;
}
```

The orchestrator persists events and writes `Found` state rows but does **not** mark them shown — that is the consumer's job, since only the UI knows which events the user actually saw. Call `curator.recordFeedback({ ids, state: SHOWN, ref })` from the consumer (e.g., per page rendered in the TUI, or once after printing in a one-shot script) to transition rows to `Shown` so the dedupe stage suppresses them on the next run. Progress events are emitted via `ctx.onProgress` if set — see "Progress events" below.

## Progress events

`curate()` accepts a second arg with an optional `onProgress(event)` listener:

```js
curator.curate(query, {
  onProgress: (e) => console.log(e.stage, e.phase, e.current, e.total),
});
```

`event` shape (see `ProgressEvent` in [src/core/types.js](../src/core/types.js)):

| Field    | Notes                                                                           |
| -------- | ------------------------------------------------------------------------------- |
| `stage`  | `ProgressStage` enum value (`queries`, `search`, `extract`, `dedupe`, `rank`, `persist`) |
| `phase`  | `ProgressPhase` enum value (`start`, `tick`, `done`)                             |
| `total`  | items expected (on `start` and `tick`)                                           |
| `current`| items processed so far (on `tick`)                                               |
| `count`  | items produced (on `done`)                                                       |
| `note`   | optional human-readable detail (e.g., adapter name during `search`)              |

The runtime enum values live in [src/core/progress.js](../src/core/progress.js) — import `ProgressStage` and `ProgressPhase` from there rather than hard-coding the strings. `PROGRESS_STAGE_ORDER` is also exported for UIs that render stages in pipeline order.

Emission contract per stage: exactly one `start`, zero or more `tick`s, exactly one `done`. `extract` and `search` emit `tick`s; the rest only emit `start`/`done`. The listener is plumbed through `ctx.onProgress`. The `discover` stage emits its own `queries` and `search` events (start/tick/done) internally; for `extract`, `dedupe`, `rank`, and `persist` the orchestrator (`src/core/pipeline.js`) emits `start` and `done` around the stage call, and the stage itself only emits `tick`s where applicable. The `persist` `start` event has no `total` (item count is unknown until the slice happens just before it).

## Adding a stage

If you need a new stage (e.g., `enrich` for venue lookups), add it under `src/stages/`, place it in the right position in `pipeline.js`, and document it here. There's no plugin system for stages — the pipeline shape is intentional.

## Errors

- Adapter errors propagate. The pipeline does not silently swallow.
- Strategy errors are caught per-strategy with a logged warning; the pipeline continues with the input it had. Rationale: a failing LLM-rank strategy shouldn't kill the whole curation; date-sort still gives a usable result.
- Extract errors per-hit are isolated (a single broken page doesn't fail the run).

## Logging

Stages and strategies log via `ctx.logger`, a levelled logger built from `config.logging.level` (defined in [src/core/config.js](../src/core/config.js)). The orchestrator emits one `info` line per stage with the in/out counts; stages emit `debug` lines with per-strategy or per-batch detail; recoverable failures (adapter, strategy, extract batch) are emitted at `warn`. Set `config.logging.level` to `info` for stage-level visibility or `debug` for full pipeline tracing. The logger interface lives in [src/core/logger.js](../src/core/logger.js).
