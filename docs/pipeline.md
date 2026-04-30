# Pipeline

The pipeline is `Query → Event[]`. Composition is fixed; only the strategies and adapters inside each stage are pluggable. See [src/core/pipeline.js](../src/core/pipeline.js) for the orchestrator and [src/stages/](../src/stages/) for the stages. Tunables (`pipeline.extractBatchTokenCap`, `pipeline.charsPerToken`, `pipeline.extractConcurrency`, `pipeline.defaultLimit`, …) are defined with their defaults in [src/core/config.js](../src/core/config.js) — that file is the source of truth.

## Why a pipeline at all

Each stage owns one transform (search → extract → dedupe → rank → persist) so failures isolate naturally and the LLM-heavy stages (extract, rank) can scale or be replaced without touching the rest. There is no separate filter stage — rank strategies may both drop and reorder events. That collapse simplifies the contract: any "filter" is just a rank strategy that removes things.

Every stage is a function of `(events, ctx) => Promise<events>`. Stages are pure with respect to `ctx` (they don't mutate it). The `ctx` shape lives in [src/core/types.js](../src/core/types.js).

## Stage contracts

- **discover** ([src/stages/discover.js](../src/stages/discover.js)) — runs `ctx.strategies.queryExpansion` concurrently (`Promise.allSettled`), unions + lower-cases the queries, then fans every `(adapter, query)` pair across `ctx.search` in parallel (`Promise.all`). Hits dedup on a canonical URL form (lowercased scheme+host, `www.` stripped, fragment removed, common tracking params dropped, trailing slash trimmed) so the same page returned with different tracking suffixes collapses to one hit. Per-strategy and per-`(adapter, query)` failures are logged and isolated; an empty `queryExpansion` array is a misconfiguration and throws.
- **extract** ([src/stages/extract.js](../src/stages/extract.js)) — groups hits into batches under `pipeline.extractBatchTokenCap` (estimated as `ceil(chars / charsPerToken)`), runs `extractEvents` per batch through a worker pool sized by `pipeline.extractConcurrency`. The LLM is required to echo each page's `SOURCE_NAME` and `SOURCE_URL` back inside `event.source`; events missing required fields are dropped. `source.fetchedAt` is stamped at the stage. A single batch failure is isolated.
- **dedupe** ([src/stages/dedupe.js](../src/stages/dedupe.js)) — runs `ctx.strategies.dedupe` in order, then consults `ctx.storage.getShownIds(ids, ref)` for **per-saved-query** cross-session suppression. Events whose only `event_states` row is `Found` (pipeline saw them but the user never did) stay eligible to resurface. The "shown" set is per-ref so a like in Berlin/comedy doesn't suppress the same event under Berlin/jazz. See [storage.md](storage.md) for why state lives off the events table.
- **rank** ([src/stages/rank.js](../src/stages/rank.js)) — runs `ctx.strategies.rank` in order; strategies may drop and reorder. Last one wins. The orchestrator slices to `ctx.query.limit ?? config.pipeline.defaultLimit` after the stage returns; rank itself never truncates. See [strategies.md](strategies.md) for the built-in chains.
- **feedback** ([src/stages/feedback.js](../src/stages/feedback.js)) — not part of `curate()`. Invoked via `curator.recordFeedback({ ids, state, reasons?, ref })`. One state per call (split likes and dislikes). When `state ∈ {LIKED, DISLIKED}` and `config.preferences.deriveTraits === true`, may refresh `SavedQuery.derivedTraits` if the LIKED+DISLIKED count for the ref crosses `config.preferences.traitsRefreshThreshold` — see [preferences.md](preferences.md).

After rank, the orchestrator calls `upsertEvents` and writes `Found` rows to `event_states` for the ref. Adapters never let `Found` overwrite a non-Found row, so prior Shown/Liked/Disliked sticks across re-curations.

## Mark-shown is the consumer's job

The orchestrator persists events and writes `Found`, but does **not** mark events `Shown` — only the UI knows what was actually displayed. The TUI calls `recordFeedback({ ids, state: SHOWN, ref })` per visible page; a one-shot script can do it once after printing. Without this call, cross-session dedupe doesn't kick in and the same events resurface forever.

## Errors

- Adapter errors propagate. The pipeline does not silently swallow.
- Strategy errors are caught per-strategy with a logged warning; the pipeline continues with the input it had. Rationale: a failing LLM-rank strategy shouldn't kill a curation that date-sort can still salvage.
- Per-hit extract errors are isolated (one broken page doesn't fail the run).

## Progress

`curate(query, { onProgress })` plumbs the listener through `ctx.onProgress`. Per-stage contract: exactly one `start`, zero or more `tick`s, exactly one `done`. `extract` and `search` emit ticks under parallel dispatch — counters bump inside `finally` so the count tracks completions, not dispatch order (CLAUDE.md rule 5).

Stage and phase enums live in [src/core/progress.js](../src/core/progress.js); `PROGRESS_STAGE_ORDER` is exported for UIs that render in pipeline order. Event shape is `ProgressEvent` in [src/core/types.js](../src/core/types.js).

The `persist` `start` event has no `total` (the count isn't known until the slice happens just before persistence).

## Logging

Stages and strategies log via `ctx.logger`, a levelled logger built from `config.logging.level` ([src/core/logger.js](../src/core/logger.js), [src/core/config.js](../src/core/config.js)). Convention: orchestrator emits one `info` line per stage with in/out counts; stages emit `debug` for per-strategy or per-batch detail; recoverable failures (adapter, strategy, extract batch) are `warn`. A `config.logging.file` value (Node only) adds a JSON-Lines file sink that captures all calls regardless of console level — useful for postmortem.

## Adding a stage

There's no plugin point. If you genuinely need a new stage (e.g. `enrich` for venue lookups), add it under `src/stages/`, wire it into `src/core/pipeline.js`, and document its contract here. Prefer extending an existing strategy chain first — the pipeline shape is intentional.
