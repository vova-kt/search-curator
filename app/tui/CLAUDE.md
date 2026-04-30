# TUI — Claude working notes

Interactive terminal client built on [ink](https://github.com/vadimdemedes/ink). Sibling to `src/`; depends only on the public API of [src/index.js](../../src/index.js). Read [docs/apps/tui.md](../../docs/apps/tui.md) for the human-facing rationale (screens, key bindings, what the TUI exercises). This file is the in-tree gotchas.

## Layout

- `index.jsx` — entry; alternate-screen-buffer setup, mounts `<App>`
- `App.jsx` — top-level state machine (which screen, curator instance, progress, feedback dispatch); also owns the `ctrl-c` global chord
- `screens/` — one file per screen, plus `screen.js` (the `Screen.X` enum)
- `keys.js` / `actions.js` / `bindings.js` / `useKeymap.js` — declarative keymap layer
- `config.js` — API key resolution: env vars > `~/.config/events-curator/config.json`
- `DislikeReasonInput.jsx` — inline TextInput for free-text dislike reasons

## Keymap layer (don't bypass)

Input is declarative, not per-screen `useInput` switches. Every screen builds a `[{ keys, action, when? }]` table and passes it to `useKeymap(bindings, handlers)`. Rules:

- **Screen names**: import `Screen.X` from `screens/screen.js`. Never inline string literals (CLAUDE.md rule #4).
- **Keys**: import descriptors from `keys.js` (`Key.ESC`, `Key.ENTER`, …) or use `char('k')` for character keys. Never check `key.escape` in raw `useInput`. `char` is case-sensitive — `char('k')` ≠ `char('K')`.
- **Actions**: import semantic verbs from `actions.js` (`Action.BACK`, `Action.MOVE_UP`, …). Never inline literals like `'back'`.
- **Cross-screen key sets**: reuse `BACK_KEYS`, `LIST_UP_KEYS`, `LIST_DOWN_KEYS`, etc. from `bindings.js` instead of re-listing descriptors. The action stays at the call site so handlers can reference local state — Results binds the back-key set to `SKIP_FEEDBACK`, not `BACK`, on purpose.
- **Gating**: when a sub-prompt (dislike reason, delete confirm, editor form-vs-menu) takes the keystream, gate every other binding `when: !promptOpen` so typed characters don't fire shortcuts.
- **Specificity order**: when a key descriptor maps to two actions depending on mode, put the more specific binding first — the dispatcher fires the first match whose `when` is not `false` and stops.

The only exception is `App.jsx`'s raw `useInput` for the `ctrl-c` chord — a single global escape hatch that calls `curator.close()` before exiting. New global chords belong there; everything screen-scoped goes through `useKeymap`.

## State that survives screen transitions

Results cursor and per-event like/dislike marks live on `App.jsx`, not on the Results screen — they need to survive a round-trip through Details. Same for free-text dislike reasons. Don't push that state down without a plan for the round-trip.

## Mark-shown contract

Results pages call `curator.recordFeedback({ ids, state: SHOWN, ref })` per visible page (see `handlePageVisible` in `App.jsx`). History (`Mode.HISTORY`) is read-only over `listShown(ref)` and does **not** mark shown. The pipeline only writes `Found` rows; the consumer is what knows the user actually saw something — see [docs/pipeline.md](../../docs/pipeline.md).

`handlePageVisible` swallows storage errors on purpose — a hiccup mid-scroll mustn't crash the TUI.

## Curator wiring

Rank chain is `[rules, llmRank]` in `App.jsx`, not the lib default `[rules, byDate]`. Combined filter + rank LLM pass with a ~5-word rationale per kept event.

`--dry` swaps in `memory()` storage plus `stubLLM()` and `stubSearch()` from `examples/_stubs.js` so the TUI runs fully offline — keymap or layout work doesn't have to spend API credits.

## Adding a screen

1. Add the value to the `Screen` enum in `screens/screen.js`.
2. Create `screens/<Name>.jsx`. Drive input through `useKeymap`; reuse cross-screen key sets from `bindings.js` where it makes sense.
3. Wire it in `App.jsx`: a render branch keyed on `screen === Screen.X`, plus the transitions in/out.
4. Update [docs/apps/tui.md](../../docs/apps/tui.md) (rationale, why this screen exists).
