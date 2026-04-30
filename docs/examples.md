# Examples

Two runnable entry points: a one-shot script under `examples/` and the interactive TUI under `app/tui/` (sibling to future front-ends like a web app). Both wire up the curator with default adapters and read keys from env.

Env-var bindings (API keys, DB path) are documented in [env.md](env.md). Runtime tunables live in [src/core/config.js](../src/core/config.js).

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

`app/tui/` is an [ink](https://github.com/vadimdemedes/ink)-based TUI exercising the full feedback loop. It lives under `app/` (alongside future front-ends such as a web app) rather than `examples/` because it is the primary interactive client. Run it via:

```bash
npm run example:cli   # alias for: tsx app/tui/index.jsx
node app/tui/index.jsx --dry   # offline, stub adapters, in-memory storage
```

### Key handling

On first run the TUI prompts for `OPENAI_API_KEY` and `TAVILY_API_KEY` and writes them to `~/.config/events-curator/config.json` (chmod `0600`). Subsequent runs read from that file. Environment variables (`OPENAI_API_KEY`, `TAVILY_API_KEY`, `OPENAI_MODEL`, `EVENTS_DB_PATH`) always override the stored values. Re-enter keys any time from the search screen with `[k]`.

The TUI runs fullscreen — it switches to the terminal's alternate-screen buffer on start and restores your scrollback on exit.

### Screens

The TUI is **list-first**: after boot you land on the saved-searches list. From there you run, edit, create, or delete a search. Identity for a saved search is `(city, queryText)`. Editing the query text replaces the row in place.

1. **Keys** — only shown when keys are missing. Tab through fields, last `enter` saves.
2. **Saved searches** — list of persisted searches with their last-run timestamp (relative). `↑/↓` move, `enter` runs the selected entry, `[e]` opens the editor, `[n]` creates a new one, `[d]` deletes (asks for `y/N`), `[a]` archives the focused entry (soft delete; archived rows are hidden from this listing), `[h]` opens the History view for the focused entry, `[K]` re-enters API keys, `[q]` quits. An empty list shows only `[n] new` / `[K] keys` / `[q] quit`.
3. **Editor** — form for one saved search. Fields cover identity (`query`, `city`), search shape (`days`, `limit`), exclusions (`excludeKeywords`, `excludeVenues`, `freeOnly`, `price.min/max/currency`), and `guidance` (natural-language filter + rank prefs). Tab through with `enter`; `esc` cancels back to the saved-searches list at any point. After the last field you land on a menu — `[s]` save, `[r]` save and run, `[c]`/`b`/`backspace`/`esc` cancel.
4. **Progress** — live stage list (build queries → search → extract → dedupe → rank → save) with a spinner on the active stage and counts (`extract 12/40 → 18`). Driven by `curator.curate()`'s `onProgress` callback (see [pipeline.md](pipeline.md)).
5. **Results** — ranked list with each event's ~5-word LLM rationale on the focused row, paged 10 per screen. `↑/↓` to move (auto-flips pages), `PgUp`/`PgDn` (or `space`) to jump a page, `g`/`G` to jump to top/bottom, `→`/`[o]` to open the focused event's details, `[l]` toggle like, `[d]` toggle dislike, `enter` to save feedback, `esc`/`q`/`b`/`backspace` to skip back. Cursor and like/dislike marks survive a round-trip through the details screen. Header shows `page N/M · showing X-Y`. As the user pages, the events on each visible page are recorded as `Shown` for the active saved query via `curator.recordFeedback({ ids, state: SHOWN, ref })`; events that were never paged into stay eligible to resurface on the next run.
6. **History** — the same Results list rendered in read-only mode against `curator.listShown({ city, queryText })`, opened from the saved-searches list with `[h]` on the focused row. No like/dislike, no feedback submit, no automatic mark-shown; just the events the user has already been shown for that saved query, most recent first. `enter`/`esc`/`q`/`b`/`backspace` returns to the saved-searches list; `→`/`[o]` opens the same details screen as Results.
7. **Details** — full record for one event: title, when (start → end if multi-day), venue, price, source link, rationale, and description. `[l]`/`[d]` toggle like/dislike (synced with the results list, hidden in history mode); `enter`/`esc`/`←`/`q`/`b`/`backspace` returns to the originating list.

Back navigation is consistent across screens that have a "back" notion: `b` and `backspace` work alongside the screen-specific keys (`esc`/`q`/`←`/`c`). On Results, `b` no longer jumps a page (use `PgUp`).

### Keymap layer

Input handling is a declarative keymap, not per-screen `useInput` switches. Four files split by concern:

- [app/tui/keys.js](../app/tui/keys.js) — `Key` enum of special-key descriptors (each `{ id, label, match(input, key) }`) plus a `char(c)` factory for character keys.
- [app/tui/actions.js](../app/tui/actions.js) — `Action` enum, the closed set of semantic verbs screens dispatch on (`BACK`, `MOVE_UP`, `TOGGLE_LIKE`, …). Per CLAUDE.md rule #4, screens import these instead of inlining string literals.
- [app/tui/bindings.js](../app/tui/bindings.js) — reusable cross-screen *key sets* (`BACK_KEYS`, `LIST_UP_KEYS`, `LIST_DOWN_KEYS`, `LIKE_KEYS`, `DISLIKE_KEYS`). Plain frozen arrays of key descriptors — action and `when` stay at the call site so handlers can reference local state.
- [app/tui/useKeymap.js](../app/tui/useKeymap.js) — generic `useKeymap(bindings, handlers)` hook. `bindings` is `[{ keys, action, when? }]` evaluated per-render; the first match whose `when` isn't `false` fires its handler. Shared backbone replacing the old per-screen `if/else if` ladders.

To add a key: add one row to the screen's binding table (and a verb to `actions.js` if no existing one fits). To keep a key consistent across screens, define or reuse a fragment in `bindings.js` rather than re-listing descriptors. App-level chords like `ctrl-c` (in [App.jsx](../app/tui/App.jsx)) still use raw `useInput` since they're a single global escape hatch.

The TUI configures rank as `[rules, llmRank]` — `rules` cheaply drops events excluded by `excludeKeywords` / `excludeVenues` / price bounds, then `llmRank` runs as a combined filter + rank LLM pass that further drops poor matches against the user's likes/dislikes and the natural-language `guidance`, attaching the rationale.

What it exercises:

- Full pipeline (`curate()`) with combined filter + rank LLM call
- Saved-query CRUD (`listSavedQueries` / `upsertSavedQuery` / `deleteSavedQuery` / `touchSavedQuery`) and soft-delete via `archived`
- Page-rendered shown tracking (`recordFeedback({ ids, state: SHOWN, ref })` per visible page) and history browsing (`listShown(...)`)
- Feedback capture (`recordFeedback({ ids, state: LIKED | DISLIKED, reasons?, ref })`)
- Per-saved-query taste profile (saved-query `(city, queryText)` keys both the junction and the trait derivation persisted to `SavedQuery.derivedTraits`)

## Tuning workflow

1. Run the script with `--dry` to confirm the pipeline works without network/credit cost.
2. Run with real keys against a small `--limit`.
3. Use the TUI (`npm run example:cli`) to mark likes/dislikes across a few sessions.
4. Inspect `events.db` directly with `sqlite3` if the curator behavior surprises you.
5. Adjust prompts in `src/prompts/` or strategies in `src/strategies/`. Re-run.
