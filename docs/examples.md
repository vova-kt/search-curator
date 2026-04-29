# Examples

Two runnable entry points under `examples/`. Both wire up the curator with default adapters and read keys from env.

## Setup

```bash
npm install
# either export OPENAI_API_KEY and TAVILY_API_KEY in your shell,
# or let the TUI prompt for them on first run (stored at ~/.config/events-curator/config.json)
```

## Script — one-shot

`examples/script.js` reads parameters from argv/env, runs one curation, prints results, exits.

```bash
node examples/script.js --city Berlin --query "indie live music" --days 14 --limit 5
```

Flags:

| Flag         | Default               | Notes                                                     |
| ------------ | --------------------- | --------------------------------------------------------- |
| `--city`     | required              |                                                           |
| `--query`    | required              | freeform initial query, e.g. `"kids weekend activities"`  |
| `--days`     | `14`                  | rolling window from today                                 |
| `--from`     | —                     | ISO date; overrides `--days`                              |
| `--to`       | —                     | ISO date; overrides `--days`                              |
| `--limit`    | `10`                  | max events to return                                      |
| `--guidance` | —                     | natural-language filter + rank preferences                |
| `--db`       | `$EVENTS_DB_PATH`     | SQLite path                                               |
| `--dry`      | `false`               | use stub adapters; no network calls                       |

Use case: smoke testing, regression checks, quick demos.

## TUI — interactive

`examples/tui/` is an [ink](https://github.com/vadimdemedes/ink)-based TUI exercising the full feedback loop. Run it via:

```bash
npm run example:cli   # alias for: tsx examples/tui/index.jsx
node examples/tui/index.jsx --dry   # offline, stub adapters, in-memory storage
```

### Key handling

On first run the TUI prompts for `OPENAI_API_KEY` and `TAVILY_API_KEY` and writes them to `~/.config/events-curator/config.json` (chmod `0600`). Subsequent runs read from that file. Environment variables (`OPENAI_API_KEY`, `TAVILY_API_KEY`, `OPENAI_MODEL`, `EVENTS_DB_PATH`) always override the stored values. Re-enter keys any time from the search screen with `[k]`.

The TUI runs fullscreen — it switches to the terminal's alternate-screen buffer on start and restores your scrollback on exit.

### Screens

The TUI is **list-first**: after boot you land on the saved-searches list. From there you run, edit, create, or delete a search. Identity for a saved search is `(city, queryText)`. Editing the query text replaces the row in place.

1. **Keys** — only shown when keys are missing. Tab through fields, last `enter` saves.
2. **Saved searches** — list of persisted searches with their last-run timestamp (relative). `↑/↓` move, `enter` runs the selected entry, `[e]` opens the editor, `[n]` creates a new one, `[d]` deletes (asks for `y/N`), `[K]` re-enters API keys, `[q]` quits. An empty list shows only `[n] new` / `[K] keys` / `[q] quit`.
3. **Editor** — form for one saved search. Fields in order: `query` (freeform), `days`, `city`, `limit`, `exclude (comma-sep)`, `filter & rank prefs` (natural language). Tab through with `enter`; `esc` cancels back to the saved-searches list at any point. After the last field you land on a menu — `[s]` save, `[r]` save and run, `[c]` cancel.
4. **Progress** — live stage list (build queries → search → extract → dedupe → filter → rank → save) with a spinner on the active stage and counts (`extract 12/40 → 18`). Driven by `curator.curate()`'s `onProgress` callback (see [pipeline.md](pipeline.md)).
5. **Results** — ranked list with each event's ~5-word LLM rationale on the focused row, paged 10 per screen. `↑/↓` to move (auto-flips pages), `PgUp`/`PgDn` (or `space`/`b`) to jump a page, `g`/`G` to jump to top/bottom, `[l]` toggle like, `[d]` toggle dislike, `enter` to save feedback, `q`/`esc` to skip. Header shows `page N/M · showing X-Y`.

The TUI explicitly opts into the `llmRank` strategy so the rank stage acts as a combined filter + rank pass — events excluded by `excludeKeywords` are dropped by the cheap `rules` filter, then the LLM further drops poor matches against the user's likes/dislikes and the natural-language `guidance`, attaching the rationale.

What it exercises:

- Full pipeline (`curate()`) with combined filter + rank LLM call
- Saved-query CRUD (`listSavedQueries` / `upsertSavedQuery` / `deleteSavedQuery` / `touchSavedQuery`)
- Feedback capture (`recordFeedback()`)
- Preference scoping (saved-query identity drives the `(city, queryText)` scope)

## Tuning workflow

1. Run the script with `--dry` to confirm the pipeline works without network/credit cost.
2. Run with real keys against a small `--limit`.
3. Use the TUI (`npm run example:cli`) to mark likes/dislikes across a few sessions.
4. Inspect `events.db` directly with `sqlite3` if the curator behavior surprises you.
5. Adjust prompts in `src/prompts/` or strategies in `src/strategies/`. Re-run.
