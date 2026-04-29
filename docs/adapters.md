# Adapters

Adapters wrap external dependencies. Three kinds: `search`, `llm`, `storage`. Each is a plain object matching a JSDoc-typed contract — no classes, no inheritance.

## Search adapter

```js
/**
 * @typedef {Object} SearchHit
 * @property {string} url
 * @property {string} title
 * @property {string} [snippet]
 * @property {string} [content]   // full page text if available
 * @property {string} source      // adapter name, e.g. 'tavily'
 */

/**
 * @typedef {Object} SearchAdapter
 * @property {string} name
 * @property {(query: string, opts?: { maxResults?: number, signal?: AbortSignal }) => Promise<SearchHit[]>} search
 */
```

Built-in:

- `adapters/search/tavily.js` — default. Cheap structured results via the Tavily API.
- `adapters/search/firecrawl.js` — opt-in. Returns full extracted page content.
- `adapters/search/playwright.js` — opt-in. Headless browser; only when JS rendering is required.

The curator accepts an array of search adapters and fans the query across all of them. Results are merged before the discover stage returns. Rate limits / timeouts are the adapter's responsibility.

## LLM adapter

```js
/**
 * @typedef {Object} LLMMessage
 * @property {'system'|'user'|'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {Object} LLMRequest
 * @property {string} system
 * @property {LLMMessage[]} messages
 * @property {boolean} [json]            // expect JSON object response
 * @property {number} [temperature]
 * @property {number} [maxTokens]
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {Object} LLMResponse
 * @property {string} text
 * @property {unknown} [json]            // populated when request.json === true
 * @property {{ inputTokens: number, outputTokens: number }} [usage]
 */

/**
 * @typedef {Object} LLMAdapter
 * @property {string} name
 * @property {string} model
 * @property {(req: LLMRequest) => Promise<LLMResponse>} chat
 */
```

Built-in:

- `adapters/llm/openai.js` — wraps the `openai` SDK. JSON mode via `response_format: { type: 'json_object' }`.

Stages call `ctx.llm.chat({ system, messages, json: true })` with prompts loaded from `src/prompts/`. Stages don't see provider specifics.

## Storage adapter

```js
/**
 * @typedef {Object} StorageAdapter
 * @property {() => Promise<void>} init                                  // open connection, ensure schema
 * @property {() => Promise<void>} close
 *
 * @property {(events: Event[]) => Promise<void>} upsertEvents
 * @property {(ids: string[]) => Promise<Set<string>>} getSeenIds
 * @property {(ids: string[]) => Promise<Event[]>} getEvents
 *
 * @property {(scope?: { city?: string, queryText?: string }) => Promise<Preference>} getPreference
 * @property {(updater: (current: Preference) => Preference, scope?: { city?: string, queryText?: string }) => Promise<Preference>} updatePreference
 * @property {(scope?: { city?: string, queryText?: string }) => Promise<void>} clearPreference
 *
 * @property {(key: string) => Promise<string | undefined>} getKV         // generic cache; callers namespace their own keys
 * @property {(key: string, value: string) => Promise<void>} setKV
 */
```

Built-in:

- `adapters/storage/sqlite.js` — Node, `better-sqlite3`. Schema applied idempotently on `init()`.
- `adapters/storage/indexeddb.js` — browser. Same conceptual schema, mapped to object stores.
- `adapters/storage/memory.js` — for tests. Implements the full interface in-memory.

See [storage.md](storage.md) for the schema. The library is in active pre-`1.0` development — there is no migration system; reset local databases when the schema changes.

## Adding a new adapter

1. Create `src/adapters/<kind>/<name>.js` exporting a factory function: `export function myAdapter(opts) { return { name: 'my', /* ... */ }; }`.
2. Implement the contract above. Validate inputs at the boundary; trust internal callers.
3. Add a subpath export to `package.json` so it's importable as `events-curator/adapters/<kind>/<name>`.
4. Add a section here describing what it does and any required env/config.
5. Add a unit test under `test/adapters/`.
