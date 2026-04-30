# Env vars

The lib core never reads `process.env` — env vars are a surface-level concern of the examples and adapter factories. Runtime tunables (model defaults, batch caps, thresholds, log level) live in [src/core/config.js](../src/core/config.js) and are passed in via `createCurator({ config })`. Keep that split: the lib stays embeddable in environments without a process env (browsers, hosted runtimes).

| Env var          | Used by                              | Purpose                       |
| ---------------- | ------------------------------------ | ----------------------------- |
| `OPENAI_API_KEY` | `adapters/llm/openai` factory        | OpenAI auth                   |
| `OPENAI_MODEL`   | `examples/*`, `app/tui/config.js`    | Model override                |
| `TAVILY_API_KEY` | `adapters/search/tavily` factory     | Tavily auth                   |
| `EVENTS_DB_PATH` | `examples/*`, `app/tui/config.js`    | SQLite file path              |

See `.env.example`. The TUI also persists keys to `~/.config/events-curator/config.json` after the first interactive entry; env vars always override the stored values (see [apps/tui.md](apps/tui.md)).
