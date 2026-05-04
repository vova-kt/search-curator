# eval/

Manual-only LLM eval pipelines. Outside the `test/**` glob, so `npm test` never runs them.

In-tree conventions live in [CLAUDE.md](CLAUDE.md). Full design rationale in [docs/eval.md](../docs/eval.md). This file is a quickstart.

## Layout

- `core/` — reusable across extract / expand / future evals
- `scripts/` — runnable CLIs
- `config.js` — single source of truth for script parameters
- `fixtures/` — committed inputs and human-curated golden truth
- `runs/` — gitignored per-run output

## How to run

Every script reads its parameters from [config.js](config.js); no CLI flags. Edit the relevant block, then:

```sh
node --env-file=.env.dev eval/scripts/fetch-search.js
node --env-file=.env.dev eval/scripts/extract/index.js
node --env-file=.env.dev eval/scripts/expand/index.js
node                     eval/scripts/promote-golden.js
```

`--env-file=.env.dev` populates `OPENAI_API_KEY` / `TAVILY_API_KEY` / etc. from your local dotenv at runtime.

## Extraction workflow

1. Set `config.fetchSearch` and run `fetch-search.js` to write `eval/fixtures/<slug>.search.json` (commit it).
2. Set `config.runExtract.fixture` to that slug and run `extract/index.js`. First run prints a bootstrap report — hand-curate the run JSON into `eval/fixtures/<slug>.golden.json` and commit.
3. Iterate on [src/prompts/extractEvents.js](../src/prompts/extractEvents.js), rerun, compare metrics.
4. Once a new prompt is clearly better, set `config.promoteGolden.fixture` and run `promote-golden.js` to copy the reviewed run's events into the golden file.

## Query-expansion workflow

1. Hand-author `eval/fixtures/<slug>.expand-input.json` with shape `{ slug, query: { city, queryText }, timeframe, limit?, nativeLanguageHints? }`.
2. Set `config.runExpand.fixture` to that slug and run `eval/scripts/expand/index.js`. First run prints metrics minus golden coverage — hand-pick the must-have phrasings into `eval/fixtures/<slug>.expand-golden.json` (`{ slug, queries: [...] }`) and commit.
3. Iterate on [src/prompts/expandQueries.js](../src/prompts/expandQueries.js), rerun, compare metrics.

## Adding a new eval kind

See [CLAUDE.md → Adding a new eval kind](CLAUDE.md#adding-a-new-eval-kind).
