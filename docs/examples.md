# Examples

Two runnable entry points: a one-shot script under [examples/](../examples/) and the interactive TUI under [app/tui/](../app/tui/) (sibling to future front-ends like a planned web app). Both wire up the curator with default adapters and read keys from env. The TUI has its own page at [apps/tui.md](apps/tui.md); this page covers the script. Env-var bindings (API keys, DB path) are in [env.md](env.md). Runtime tunables live in [src/core/config.js](../src/core/config.js).

## Script — one-shot

[examples/script.js](../examples/script.js) reads parameters from argv/env, runs one curation, prints results, exits. The argv/env contract is defined in that file — rather than mirror flag tables here (they rot), run with `--help` or read the source.

```bash
node examples/script.js --city Berlin --query "indie live music" --days 14 --limit 5
node examples/script.js --city Berlin --query "indie live music" --dry   # offline, no network
```

Use case: smoke testing, regression checks, quick demos. The script does **not** mark events `Shown` automatically — for one-shot runs that's fine, since the next run you do is typically a different query; if you want shown-tracking, add a `recordFeedback({ state: SHOWN, ... })` call after the print.

## TUI — interactive

```bash
npm run example:cli              # alias for: tsx app/tui/index.jsx
node app/tui/index.jsx --dry     # offline, stub adapters, in-memory storage
```

The TUI is the primary way to exercise the full feedback loop (saved-query CRUD, page-rendered shown tracking, like/dislike capture, history). Screens, key bindings, and the keymap-layer architecture live in [apps/tui.md](apps/tui.md).

## Tuning workflow

1. Run the script with `--dry` to confirm the pipeline works without network/credit cost.
2. Run with real keys against a small `--limit` to spot-check extraction.
3. Use the TUI to mark likes/dislikes across a few sessions — that's how `derivedTraits` builds up and how cross-session dedupe takes effect.
4. Inspect `events.db` directly with `sqlite3` if curator behavior surprises you — the schema in [storage.md](storage.md) tells you which table to look at.
5. Adjust prompts in [src/prompts/](../src/prompts/) or strategies in [src/strategies/](../src/strategies/) and re-run. For prompt iteration specifically, the [eval pipeline](eval.md) is faster than re-running the full curator each time.
