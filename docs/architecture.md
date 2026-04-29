# Architecture

## One-line model

A curator is a **pipeline** wrapping three pluggable I/O adapters (search, LLM, storage) and pluggable algorithmic strategies (query expansion, dedupe, rank). Adapters are how we talk to the outside world. Strategies are how we shape the result set. Stages are where the work actually happens. Filtering is not a separate stage — rank strategies may both drop and reorder events.

## Layers

```
┌────────────────────────────────────────────────────────┐
│ examples/        examples/script.js, examples/tui/     │
├────────────────────────────────────────────────────────┤
│ public API       src/index.js  →  createCurator()      │
├────────────────────────────────────────────────────────┤
│ pipeline         src/core/pipeline.js                  │
│                    ├── src/stages/discover.js          │
│                    ├── src/stages/extract.js           │
│                    ├── src/stages/dedupe.js            │
│                    ├── src/stages/rank.js              │
│                    └── src/stages/feedback.js          │
├────────────────────────────────────────────────────────┤
│ strategies       src/strategies/{queryExpansion,dedupe,rank}/ │
├────────────────────────────────────────────────────────┤
│ adapters         src/adapters/{search,llm,storage}/    │
├────────────────────────────────────────────────────────┤
│ core             src/core/{types,config}.js            │
│                  src/prompts/*.js                      │
└────────────────────────────────────────────────────────┘
```

Higher layers depend on lower ones, never the other way around. Stages depend on adapter *interfaces*, not concrete adapters.

## Module boundaries

- **`core/`** — types and config only. No I/O. No imports from `adapters/` or `stages/`.
- **`prompts/`** — pure functions returning `{ system, user }` strings. No I/O. Imported by stages.
- **`adapters/`** — concrete I/O (HTTP, SQLite, IndexedDB, OpenAI SDK). Each adapter file is independently importable so a browser build never sees `better-sqlite3`.
- **`strategies/`** — pure functions over events. May call the LLM adapter through `ctx.llm` if they're LLM-backed.
- **`stages/`** — orchestrate adapters + strategies. Receive `(events, ctx)`, return events.
- **`core/pipeline.js`** — wires stages in order. The only place that knows the full sequence.
- **`index.js`** — assembles `ctx`, exposes `curate()` / `recordFeedback()` / `listShown()` / saved-query CRUD / `close()`.

## Why this shape

- **Pluggability**: every external dependency goes through an adapter interface. New search engine? New file in `adapters/search/`, registered when constructing the curator.
- **Browser friendliness**: subpath exports (`events-curator/adapters/storage/indexeddb`) mean the browser bundle never imports Node-only modules.
- **Testability**: stages are functions of `(events, ctx) => events`. Drop in `memory` storage and stub adapters; no network or filesystem in tests.
- **Replaceability**: prompts in their own files, strategies as pure functions — the parts most likely to change live where they're easy to edit without touching the pipeline.

## Data flow

```
Query  ─▶  discover  ─▶  extract  ─▶  dedupe  ─▶  rank  ─▶  Result
            │              │            │          │
            ▼              ▼            ▼          ▼
         search         LLM +        strategies  strategies (rules + byDate/llmRank)
         adapter        browser                  + savedQuery + state (drops + reorders)
                                          │
                                          ▼
                                       storage  ◀── feedback (state transitions: shown/liked/disliked)
```

See [pipeline.md](pipeline.md) for the per-stage contract.

## Browser story

Same code, different adapters:

| Concern  | Node                         | Browser                                    |
| -------- | ---------------------------- | ------------------------------------------ |
| Storage  | `adapters/storage/sqlite`    | `adapters/storage/indexeddb`               |
| LLM      | `adapters/llm/openai` direct | `adapters/llm/openai` via thin user-side proxy |
| Search   | direct HTTP                  | via the same proxy (key safety)            |

The lib never stores anything server-side. See [storage.md](storage.md).
