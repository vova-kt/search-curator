# Adapters

Adapters wrap external dependencies. Three kinds: `search`, `llm`, `storage`. Each is a plain object matching a JSDoc-typed contract — no classes, no inheritance.

## Why this shape

A factory function returning a plain object is the smallest interface that lets us swap implementations between Node and browser bundles without conditional imports. The contract lives in JSDoc next to the type — see [src/core/types.js](../src/core/types.js) for `SearchAdapter`, `LLMAdapter`, `StorageAdapter`. Adapter modules are independently importable (subpath exports in `package.json`) so a browser build never has to see `better-sqlite3`.

## The three kinds

### Search

[src/adapters/search/](../src/adapters/search/). Used by the discover stage — see [pipeline.md](pipeline.md). The curator accepts an *array* of search adapters and fans every expanded query across all of them. Rate limits / timeouts are the adapter's responsibility.

Built-ins:

- **tavily** ([src/adapters/search/tavily.js](../src/adapters/search/tavily.js)) — default. Cheap structured results via the Tavily API.
- **firecrawl** ([src/adapters/search/firecrawl.js](../src/adapters/search/firecrawl.js)) — opt-in. Returns full extracted page content, useful when extraction quality on a tricky source is too low with snippets alone.
- **playwright** ([src/adapters/search/playwright.js](../src/adapters/search/playwright.js)) — opt-in. Headless browser; only when JS rendering is genuinely required. Heavy.

### LLM

[src/adapters/llm/](../src/adapters/llm/). Stages call `ctx.llm.chat({ system, messages, json: true })` with prompts loaded from [src/prompts/](../src/prompts/) — see [prompts.md](prompts.md). Stages don't see provider specifics.

Built-in:

- **openai** ([src/adapters/llm/openai.js](../src/adapters/llm/openai.js)) — wraps the `openai` SDK. JSON mode via `response_format: { type: 'json_object' }`. Factory takes only `{ apiKey, baseURL }` — all behavior params (`temperature`, `maxTokens`, `maxRetries`, `reasoningEffort`) flow through `LLMRequest`, not the factory. Usage (`{ inputTokens, outputTokens }`) is always returned.

### Storage

[src/adapters/storage/](../src/adapters/storage/). For why the data is shaped this way (per-saved-query state, why no migrations) see [storage.md](storage.md). The contract covers four logical concerns: events, event_states (per-ref state machine), saved_queries, and a generic kv table.

Built-ins:

- **sqlite** ([src/adapters/storage/sqlite.js](../src/adapters/storage/sqlite.js)) — Node, `better-sqlite3`. Schema applied idempotently on `init()`.
- **indexeddb** ([src/adapters/storage/indexeddb.js](../src/adapters/storage/indexeddb.js)) — browser. Same conceptual schema, mapped to object stores; bumps version when stores change.
- **memory** ([src/adapters/storage/memory.js](../src/adapters/storage/memory.js)) — for tests. Implements the full interface in-memory.

The library is in active pre-`1.0` development — there is no migration system; reset local databases when the schema changes.

## Adding an adapter

1. Create `src/adapters/<kind>/<name>.js` exporting a factory function — `export function myAdapter(opts) { return { name: 'my', /* ... */ }; }`.
2. Implement the JSDoc contract in [src/core/types.js](../src/core/types.js). Validate inputs at the boundary; trust internal callers.
3. Add a subpath export to `package.json` so it's importable as `events-curator/adapters/<kind>/<name>` — that's what keeps Node-only deps out of the browser bundle.
4. Add a unit test under `test/adapters/`.
5. If the adapter has notable tradeoffs or non-obvious failure modes, mention them on the relevant section of this page.

For a search adapter specifically, "added correctly" means a curator constructed with `[myAdapter()]` in `ctx.search` returns hits when run against the test fixtures; for a storage adapter, it's that the existing storage tests in `test/adapters/storage/` pass when pointed at it.
