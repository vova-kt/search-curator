# Architecture

## One-line model

A curator is a **pipeline** wrapping three pluggable I/O adapters (search, LLM, storage) and pluggable algorithmic strategies (query expansion, dedupe, rank). Adapters are how we talk to the outside world. Strategies are how we shape the result set. Stages are where the work happens. Filtering is not a separate stage — rank strategies may both drop and reorder events.

## Layers

```
┌────────────────────────────────────────────────────────┐
│ front-ends       app/tui/  (web app planned)           │
│ examples         examples/script.js                    │
├────────────────────────────────────────────────────────┤
│ public API       src/index.js  →  createCurator()      │
├────────────────────────────────────────────────────────┤
│ pipeline         src/core/pipeline.js                  │
│                    └── src/stages/{discover,extract,   │
│                                    dedupe,rank,        │
│                                    feedback}.js        │
├────────────────────────────────────────────────────────┤
│ strategies       src/strategies/{queryExpansion,       │
│                                  dedupe,rank}/         │
├────────────────────────────────────────────────────────┤
│ adapters         src/adapters/{search,llm,storage}/    │
├────────────────────────────────────────────────────────┤
│ core             src/core/{types,config,context,        │
│                            progress,eventState,logger}  │
│                  src/prompts/*.js                      │
└────────────────────────────────────────────────────────┘
```

Higher layers depend on lower ones, never the other way around. Stages depend on adapter *interfaces*, not concrete adapters. `core/` has no I/O.

## Why this shape

- **Pluggability.** Every external dependency goes through an adapter interface. New search engine? Drop a file in `adapters/search/`, register it when constructing the curator. No core changes.
- **Browser friendliness.** Subpath exports (`events-curator/adapters/storage/indexeddb`) mean the browser bundle never imports `better-sqlite3`. Same lib, different adapters.
- **Testability.** Stages are pure functions of `(events, ctx, query)`. Build ctx once via `createContext()` with `memory` storage and stub adapters; no network or filesystem in tests.
- **Replaceability where churn happens.** Prompts in their own files; strategies as pure functions. The parts most likely to change live where they're easy to edit without touching the pipeline.

## Data flow

```
Query  ─▶  discover  ─▶  extract  ─▶  dedupe  ─▶  rank  ─▶  Result
            │              │            │          │
            ▼              ▼            ▼          ▼
         search         LLM +        strategies  strategies + savedQuery
         adapters       worker pool              (drops + reorders)
                                          │
                                          ▼
                                       storage  ◀── feedback
                                                    (state transitions:
                                                     shown / liked / disliked)
```

See [pipeline.md](pipeline.md) for per-stage contracts.

## Browser story

Same code, different adapters:

| Concern  | Node                         | Browser                                        |
| -------- | ---------------------------- | ---------------------------------------------- |
| Storage  | `adapters/storage/sqlite`    | `adapters/storage/indexeddb`                   |
| LLM      | `adapters/llm/openai` direct | `adapters/llm/openai` via thin user-side proxy |
| Search   | direct HTTP                  | via the same proxy (key safety)                |

The lib never stores anything server-side. See [storage.md](storage.md).
