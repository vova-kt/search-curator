# events-curator — Claude working notes

AI-curated upcoming events. Pluggable search engines, LLMs, storage, and ranking strategies. Runs in Node and (with the right adapters) in the browser.

> **Status: active pre-`1.0` development.** Nothing is stable. Schemas, public APIs, config shapes, prompt contracts, and strategy interfaces all change without notice. There is no migration system for storage — when the schema changes, reset local databases. Don't add migrations, deprecation shims, or "legacy" branches.

## Development rules

These are project rules. Follow them on every change.

1. **Update docs and `CLAUDE.md` after each change.** Whenever behavior, architecture, public API, config, prompts, or strategies change, update the relevant `docs/*.md` page and this file. Docs are the source of truth, not commit messages. If you're not updating docs, you're not done.
2. **Bug fixes target the root cause.** Do not patch symptoms, swallow errors, or special-case the failing input. Trace the failure to the underlying cause and fix it there. If the root cause is out of scope, say so explicitly and stop — don't ship a workaround silently.
3. **No backward compatibility while in development.** The lib is pre-`1.0`. Rename, restructure, drop fields, change return shapes whenever it makes the design better. Don't add deprecation shims, "legacy" branches, aliases, or migrations. Just change it and update the docs.
4. **Use enums, not raw string/number constants, for closed sets of values.** Any value drawn from a fixed set that's used in more than one place — stage names, phase names, categories, status codes, kinds, modes — must be defined as a frozen enum object (e.g. `Object.freeze({ FOO: 'foo' })`) in a dedicated module and imported. Do not hard-code the underlying literals at call sites. JSDoc string-literal unions stay as the type contract; the enum is the single source of truth for the runtime values. Existing example: [src/core/progress.js](src/core/progress.js).
5. **Multiple web/LLM requests run concurrently.** When a stage, strategy, or adapter issues more than one network or LLM call whose inputs are known up front, dispatch them in parallel — `Promise.all` for fail-fast aggregation, `Promise.allSettled` when one failure must not abort the rest, or a bounded worker pool when the fan-out is large enough to need a concurrency cap (see [src/stages/extract.js](src/stages/extract.js) for the worker-pool pattern and `pipeline.extractConcurrency` in [src/core/config.js](src/core/config.js)). Sequential `await` in a loop is only acceptable when each request genuinely depends on the previous one's response (e.g., the filter/rank strategy chains, where each strategy operates on the previous strategy's output). Tick-style progress emission stays correct under parallel dispatch — increment the counter inside a `finally` block, as [src/stages/discover.js](src/stages/discover.js) does.

## Where things live

The `docs/` directory is the canonical reference. Read the page that matches your task before editing code.

- [docs/architecture.md](docs/architecture.md) — top-level layout, layering, and module boundaries
- [docs/pipeline.md](docs/pipeline.md) — stages (discover → extract → dedupe → filter → rank → feedback), data flow, contracts
- [docs/adapters.md](docs/adapters.md) — search, LLM, storage adapter contracts and how to add a new one
- [docs/strategies.md](docs/strategies.md) — pluggable dedupe / filter / rank strategy contracts
- [docs/storage.md](docs/storage.md) — schema, SQLite vs IndexedDB vs memory
- [docs/prompts.md](docs/prompts.md) — where prompts live, the `({...args}) => {system, user}` shape, how to add one
- [docs/prompts_guide.md](docs/prompts_guide.md) — authoring rules: XML-tagged section order, long-input exception, model-specific notes
- [docs/preferences.md](docs/preferences.md) — preference shape, like/dislike capture, scoped clearing
- [docs/examples.md](docs/examples.md) — running the script and CLI examples
- [docs/env.md](docs/env.md) — env-var bindings for API keys and DB path
- [docs/eval.md](docs/eval.md) — manual-only LLM eval pipelines (extract today, rank next) for prompt iteration
- [docs/contributing.md](docs/contributing.md) — the three rules above, restated for humans, plus dev workflow

## Quick orientation

- **Public entry**: [src/index.js](src/index.js) — `createCurator({ llm, search, storage, strategies, config })`
- **Pipeline**: [src/core/pipeline.js](src/core/pipeline.js) calls stages in [src/stages/](src/stages/)
- **Types**: [src/core/types.js](src/core/types.js) — JSDoc typedefs only, no runtime
- **Config**: [src/core/config.js](src/core/config.js) — `DEFAULTS` is the canonical, self-documenting source of truth for every tunable; merge logic and override flow are documented inline.
- **Logger**: [src/core/logger.js](src/core/logger.js) — levelled `ctx.logger` built from `config.logging.level`. Stages/strategies use it instead of `console.*`.
- **Prompts**: [src/prompts/](src/prompts/) — one file per prompt, exports a function returning `{ system, user }`
- **Storage schema**: defined inline in each adapter — see [src/adapters/storage/sqlite.js](src/adapters/storage/sqlite.js) and [src/adapters/storage/indexeddb.js](src/adapters/storage/indexeddb.js). Logical tables: `events` (everything curation produced), `event_states` (per-saved-query junction recording each event's lifecycle state — `Found` / `Shown` / `Liked` / `Disliked`, plus an optional `reason` and `state_at`; enum lives in [src/core/eventState.js](src/core/eventState.js)), `kv`, and `saved_queries` for user-defined searches keyed on `(city, queryText)` with taste configuration (`excludeKeywords`, `excludeVenues`, `price`, `freeOnly`, `guidance`, `derivedTraits`, `archived`). Cross-session dedupe is per-saved-query: `getShownIds(ids, ref)` returns ids whose state ∈ {Shown, Liked, Disliked} for that ref. The pipeline writes `Found` rows after `upsertEvents`; adapters never let `Found` overwrite a non-Found row. Consumers transition rows by calling `curator.recordFeedback({ ids, state, ref })` — there is no separate `markShown`. The TUI calls it per page rendered with `state: SHOWN`.
- **Rank stage (filter + rank unified)**: there is no separate filter stage. Rank strategies may both drop events and reorder them. `rules` reads `excludeKeywords` / `excludeVenues` / `price` / `freeOnly` from `ctx.query.savedQuery` (auto-loaded by `curate()`); `byDate` reorders chronologically; `llmRank` is a combined filter + rank LLM pass that pulls liked/disliked from `getEventStates(ref)`, reads `derivedTraits` off `ctx.query.savedQuery`, omits poor matches, and attaches a ~5-word rationale. Default chain is `[rules, byDate]`; the TUI uses `[rules, llmRank]`. Don't reintroduce a separate filter stage.
- **TUI**: list-first under [app/tui/](app/tui/) (the `app/` folder will house multiple front-ends; web is planned). Screen names are an enum at [app/tui/screens/screen.js](app/tui/screens/screen.js); add to that enum rather than introducing string literals. Input handling uses a declarative keymap layer: key descriptors in [app/tui/keys.js](app/tui/keys.js) (`Key.*` + `char(c)`), semantic verbs in [app/tui/actions.js](app/tui/actions.js), reusable cross-screen key sets (`BACK_KEYS`, `LIST_UP_KEYS`, `LIST_DOWN_KEYS`, `LIKE_KEYS`, `DISLIKE_KEYS`) in [app/tui/bindings.js](app/tui/bindings.js), and a generic `useKeymap(bindings, handlers)` hook in [app/tui/useKeymap.js](app/tui/useKeymap.js). Screens declare a `[{ keys, action, when? }]` table instead of branching on raw `useInput` arguments — adding a new key/action is one row of data, not another `else if`. Reuse the shared key-set constants from `bindings.js` for navigation that should stay consistent (back, list cursor, like/dislike); only the action and `when` clause stay at the call site. New verbs go in `actions.js`; never inline string literals or raw `key.escape` checks.

## Dev commands

- `npm install` — installs deps
- `npm run typecheck` — runs `tsc --noEmit` against JSDoc-annotated JS
- `npm run build:types` — emits `.d.ts` into `types/`
- `npm test` — runs `node --test`
- `npm run example:script` — one-shot run with argv/env
- `npm run example:cli` — interactive REPL with feedback capture

## When making changes

1. Read the relevant `docs/` page.
2. Make the code change.
3. Update the docs page if behavior/contract/shape changed.
4. Update this `CLAUDE.md` only if a rule, doc index entry, or quick-orientation pointer changed.
5. Run `npm run typecheck` and `npm test`.
