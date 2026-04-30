# TUI

Interactive terminal client built on [ink](https://github.com/vadimdemedes/ink), at [app/tui/](../../app/tui/). Sibling to future front-ends like a planned web app — depends only on the public API of [src/index.js](../../src/index.js). For the in-tree gotchas (state-survival rules, mark-shown contract, keymap-layer ground rules) see [app/tui/CLAUDE.md](../../app/tui/CLAUDE.md); this page is the human rationale.

## Why a TUI as the primary front-end

The TUI exists because the curator's most-changing surface is the rank+feedback loop, and the fastest way to iterate on it is to actually use it. A list-first, keyboard-driven UI in the terminal:

- needs no build step or browser; runs the same code path as the lib;
- captures real input traces (likes, dislikes, free-text reasons) into the same SQLite database the script writes to;
- is small enough that screen-level UX questions can be answered by reading one file.

Identity for a saved search is `(city, queryText)` — same key the storage layer uses. Editing the freeform text replaces the saved row in place. The TUI runs fullscreen; it switches the terminal into the alternate-screen buffer on start and restores scrollback on exit.

## Run

```bash
npm run example:cli              # alias for: tsx app/tui/index.jsx
node app/tui/index.jsx --dry     # offline, stub adapters, in-memory storage
```

## Screens

Screen names live in the frozen enum at [app/tui/screens/screen.js](../../app/tui/screens/screen.js); the file's existence is the contract — call sites import `Screen.X` rather than inlining literals. Implementations are in [app/tui/screens/](../../app/tui/screens/) (one file per screen).

The screen the user lands on after boot depends on credentials: with keys, **Saved searches**; without, **Keys** first, then **Saved searches** after a successful save.

- **Keys** — only shown when API keys are missing; persists `OPENAI_API_KEY` and `TAVILY_API_KEY` to `~/.config/events-curator/config.json` (chmod `0600`). Re-enter from the home screen any time. Why a separate screen rather than env-only: first-run users without env vars need a single coherent flow that doesn't bounce them out to a shell.
- **Saved searches** — home screen. List of persisted searches with each row's last-run relative timestamp. From here you run, edit, create, delete, archive (soft delete), or open the history of a saved search. An empty list collapses to a minimal action set.
- **Editor** — form for one `SavedQuery`. Fields cover identity (`query`, `city`), search shape (`days`, `limit`), exclusions (`excludeKeywords`, `excludeVenues`, `freeOnly`, `price`), and `guidance` (natural-language filter + rank prefs). Tab-through with `enter`; `esc` cancels at any point. After the last field, focus moves to a save / save-and-run / re-edit / cancel menu — the menu is gated against the form's `TextInput` keys so cancel shortcuts don't fight typing.
- **Progress** — live stage list (build queries → search → extract → dedupe → rank → save) with a spinner on the active stage and counts. Driven by `curator.curate()`'s `onProgress` callback — see [pipeline.md](../pipeline.md). Stage labels and ordering come from `PROGRESS_STAGE_ORDER` ([src/core/progress.js](../../src/core/progress.js)).
- **Results** — ranked list, paged 10 per screen. Focused row's ~5-word LLM rationale is shown beneath. Like / dislike toggles per row; dislike opens a free-text reason prompt (see below). `enter` submits feedback; `esc` skips back (records empty feedback and returns home). As the user pages, events on each newly-visible page are recorded as `Shown` for the active saved query — see "mark-shown contract" below. Cursor and like/dislike marks survive a round-trip through Details.
- **History** — Results in read-only mode against `curator.listShown(ref)`, opened from Saved searches. No like/dislike toggles, no automatic mark-shown — just events the user has already been shown for that saved query, most recent first.
- **Details** — full record for one event (title, when, venue, price, source link, rationale, description). Like/dislike syncs with Results (and is hidden when opened from History).

For exact key bindings per screen, read the screen's `.jsx` file — they live in `useKeymap` tables right next to the handlers. Mirroring them here would rot the moment a binding changed.

## Keymap layer (why it's split four ways)

Input handling is a declarative keymap, not per-screen `useInput` switches. Four files split by concern, in [app/tui/](../../app/tui/):

- **`keys.js`** — `Key` enum of special-key descriptors (`{ id, label, match }`) plus a `char(c)` factory for character keys.
- **`actions.js`** — `Action` enum, the closed set of semantic verbs screens dispatch on.
- **`bindings.js`** — reusable cross-screen *key sets* (`BACK_KEYS`, `LIST_UP_KEYS`, `LIKE_KEYS`, …). Plain frozen arrays — the action and `when` clause stay at the call site so handlers can reference local state.
- **`useKeymap.js`** — generic `useKeymap(bindings, handlers)` hook. `bindings` is `[{ keys, action, when? }]`, evaluated per-render; first match whose `when` is not `false` fires.

The split lets:

- **Multiple keys map to one action** — `BACK ← esc/q/b/⌫` — without handlers needing to know which key fired.
- **One key set serve different actions per screen** — Results binds the back-key set to `SKIP_FEEDBACK`, not `BACK`, so it can record an empty-feedback skip rather than ignoring the marks silently. That's why `bindings.js` exports key arrays, not full `{ keys, action }` rows.
- **Bindings be evaluated per-render** — the `when` clause sees current props and state, so a screen can disable its bindings while a sub-prompt has the keystream (dislike reason, delete confirm, editor form-vs-menu).

The only raw `useInput` is in [App.jsx](../../app/tui/App.jsx) for the `ctrl-c` chord — a single global escape hatch that runs `curator.close()` before exiting so the SQLite handle releases cleanly. New global chords (if any) belong there; everything screen-scoped goes through `useKeymap`.

## Curator wiring

The TUI configures rank as `[rules, llmRank]` (not the lib default `[rules, byDate]`): `rules` cheaply drops events excluded by `excludeKeywords` / `excludeVenues` / price bounds, then `llmRank` runs as a combined filter + rank LLM pass that further drops poor matches against the user's likes/dislikes and the natural-language `guidance`, attaching a ~5-word rationale. See [strategies.md](../strategies.md) for strategy details and [pipeline.md](../pipeline.md) for the rank stage.

Storage defaults to SQLite at `EVENTS_DB_PATH` (or `./events.db`); `--dry` swaps in `memory()` plus stub LLM and search adapters so it runs fully offline. API key resolution lives in [app/tui/config.js](../../app/tui/config.js); the env-var contract itself is shared with the script entry point and documented in [env.md](../env.md).

## Mark-shown contract

The pipeline writes `Found` rows but does **not** mark events `Shown` — only the UI knows what was actually displayed. The TUI calls `recordFeedback({ ids, state: SHOWN, ref })` per visible page (`handlePageVisible` in `App.jsx`), and that's what makes cross-session dedupe work for the next run. History does *not* mark shown — it's a read-only view over `listShown`. Storage errors during page-shown recording are swallowed on purpose; a hiccup mid-scroll mustn't crash the TUI.

## What it exercises (vs. the script)

The script exercises a single curation. The TUI exercises the loop:

- saved-query CRUD (`listSavedQueries` / `upsertSavedQuery` / `deleteSavedQuery` / `touchSavedQuery`, soft-delete via `archived`);
- page-rendered shown tracking;
- history browsing (`listShown(ref)`);
- like/dislike capture, with free-text reasons for dislikes;
- per-saved-query taste profile, including lazy `derivedTraits` refresh — see [preferences.md](../preferences.md).

That's the surface most likely to change as the project iterates, which is why the TUI is the primary front-end and not just an example.
