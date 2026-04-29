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
node examples/script.js --city Berlin --category comedy --days 14 --limit 5
```

Flags:

| Flag         | Default               | Notes                                  |
| ------------ | --------------------- | -------------------------------------- |
| `--city`     | required              |                                        |
| `--category` | required              | comedy, concert, theater, …            |
| `--days`     | `14`                  | rolling window from today              |
| `--from`     | —                     | ISO date; overrides `--days`           |
| `--to`       | —                     | ISO date; overrides `--days`           |
| `--limit`    | `10`                  | max events to return                   |
| `--db`       | `$EVENTS_DB_PATH`     | SQLite path                            |
| `--dry`      | `false`               | use stub adapters; no network calls    |

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

1. **Keys** — only shown when keys are missing. Tab through fields, last `enter` saves.
2. **Search** — form for `city`, `category`, `days`, `limit`. Tab through; after the last field you land on a hotkey menu.
3. **Progress** — live stage list (build queries → search → extract → dedupe → filter → rank → save) with a spinner on the active stage and counts (`extract 12/40 → 18`). Driven by `curator.curate()`'s `onProgress` callback (see [pipeline.md](pipeline.md)).
4. **Results** — ranked list. `↑/↓` to move, `[l]` toggle like, `[d]` toggle dislike, `enter` to save feedback, `q`/`esc` to skip.

### Search-screen hotkeys

| Key | Effect                                  |
| --- | --------------------------------------- |
| `r` | run curation with current params        |
| `e` | re-edit fields                          |
| `k` | edit stored API keys                    |
| `c` | clear preferences for the current city  |
| `C` | clear all preferences                   |
| `q` | quit                                    |

What it exercises:

- Full pipeline (`curate()`)
- Feedback capture (`recordFeedback()`)
- Preference scoping (change `city` between runs)
- `clearPreferences()` via `c` / `C` hotkeys

## Tuning workflow

1. Run the script with `--dry` to confirm the pipeline works without network/credit cost.
2. Run with real keys against a small `--limit`.
3. Use the TUI (`npm run example:cli`) to mark likes/dislikes across a few sessions.
4. Inspect `events.db` directly with `sqlite3` if the curator behavior surprises you.
5. Adjust prompts in `src/prompts/` or strategies in `src/strategies/`. Re-run.
