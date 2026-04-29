# Config

All tunable constants live in `src/core/config.js`. Adapters and stages read from `ctx.config`, never from env vars directly. Env vars are read only at entry points (examples, adapter factories).

## Defaults

```js
export const DEFAULTS = Object.freeze({
  dev: false,                    // set true to surface strategy errors instead of falling back
  llm: {
    model: 'gpt-4o-mini',
    temperature: 0.2,
    maxTokens: 4096,
  },
  search: {
    maxResultsPerAdapter: 20,
    timeoutMs: 15_000,
  },
  pipeline: {
    defaultLimit: 10,
    defaultRollingDays: 14,
    extractConcurrency: 4,
  },
  queryExpansion: {
    defaultLimit: 8,             // max queries `llmExpand` returns when no per-call limit is given
  },
  dedupe: {
    fuzzyTitleThreshold: 0.85,
  },
  preferences: {
    deriveTraits: true,
    traitsRefreshThreshold: 5,   // re-derive after N new liked/disliked
  },
});
```

`dev` is the global "be loud about errors" switch. Strategies that have a graceful fallback (currently `llmExpand`) re-throw the underlying error in dev mode and warn-and-fallback in prod (the default).

## Override merge order

`createCurator({ config })` deep-merges in this order (later wins):

1. `DEFAULTS`
2. User-provided `config` object
3. (No env-var layer — adapters take their own config in their factory.)

Result is frozen and stored as `ctx.config`. Nothing in the pipeline mutates it.

## Adding a config key

1. Add it to `DEFAULTS` with a value.
2. Document it here under the right section.
3. Read it via `ctx.config.<section>.<key>`.
4. If it controls a stage's behavior, mention it in [pipeline.md](pipeline.md).

## Env var bindings

Env vars are surface-level concerns of the *examples* and *adapter factories*. The lib core never reads `process.env`.

| Env var          | Used by                                              | Purpose                       |
| ---------------- | ---------------------------------------------------- | ----------------------------- |
| `OPENAI_API_KEY` | `adapters/llm/openai` (factory)                      | OpenAI auth                   |
| `OPENAI_MODEL`   | `examples/*`                                         | Convenient model override     |
| `TAVILY_API_KEY` | `adapters/search/tavily` (factory)                   | Tavily auth                   |
| `EVENTS_DB_PATH` | `examples/*`                                         | SQLite file path              |

See `.env.example`.
