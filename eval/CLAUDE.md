# eval/ — Claude working notes

Manual LLM eval pipelines for prompt iteration. Outside the `test/**` glob — `npm test` never picks them up. Real network and LLM calls; not free. Public-facing rationale lives in [docs/eval.md](../docs/eval.md); this file covers in-tree conventions.

## Conventions

1. **Config object, never argv.** Every script reads its parameters from [eval/config.js](config.js). Don't add CLI flag parsing or `process.argv` reads to scripts. The iteration loop is "edit the config block, save, run" — no shell-quoting friction.
2. **API keys via `node --env-file=.env.dev`.** Never read `.env*` files directly. Scripts call `requireEnv('OPENAI_API_KEY')` from [core/env.js](core/env.js); Node's `--env-file` populates `process.env` at runtime. Keys never appear in source.
3. **Two fixture files per eval kind.** Inputs and human-curated golden truth are separate files joined by the slug, each in a subfolder of `eval/fixtures/` named after the kind — `search/<slug>.search.json`, `extract/<slug>.golden.json`, `expand/<slug>.expand-golden.json`. When adding a kind, add a subfolder and path helpers in [core/fixtures.js](core/fixtures.js).
4. **`RunKind` is an enum.** Use `RunKind.EXTRACT` / `EXPAND` / `RANK` from [core/runKind.js](core/runKind.js). Don't write raw string literals (project rule 4).
5. **No `deepEqual` against golden.** The eval is a metrics report, not a regression test. Golden is the human's reference for *interpreting* the report, not pass/fail input. `temperature: 0` reduces variance but doesn't eliminate it.
6. **Stages called directly.** Use the bare strategy or stage function (`extract(hits, ctx)`, `llmExpand()(ctx)`) with a minimal ctx from [core/ctx.js](core/ctx.js). Don't pull in the orchestrator, storage, or other stages — that defeats the point of isolating one piece for evaluation.

## Adding a new eval kind

1. Add a `<kind>` block to `config.js`.
2. Add `<slug>.<kind>-input.json` / `<slug>.<kind>-golden.json` path + load helpers to [core/fixtures.js](core/fixtures.js).
3. Add `RunKind.<KIND>` to [core/runKind.js](core/runKind.js).
4. Add reusable metrics to [core/metrics.js](core/metrics.js); kind-specific computation can stay inline in the script.
5. Create `scripts/<kind>/index.js` modeled on [extract/](scripts/extract/) or [expand/](scripts/expand/) — load fixtures, build ctx, call the strategy, render report, `writeRun(...)`.

## Gotchas

- A new fixture's first run has no golden; the script prints a bootstrap report instead. Hand-curate the run's output into the golden file before the second run.
- The slug encodes `(queryText, city, days, fromDate)` ([core/slug.js](core/slug.js)). Changing any of those produces a new slug — old fixtures and runs stay valid for the old slug.
- `runs/` is gitignored. Don't try to commit a run as a golden — use [scripts/promote-golden.js](scripts/promote-golden.js), which prints a reviewable diff summary.
