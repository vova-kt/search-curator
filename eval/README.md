# eval/

Manual-only LLM eval pipelines. Outside the `test/**` glob, so `npm test` never runs them.

The full reference is [docs/eval.md](../docs/eval.md). This file is a quickstart.

## Layout

- `core/` — reusable across extract / rank / future evals
- `scripts/` — runnable CLIs
- `fixtures/` — committed `<slug>.search.json` and `<slug>.golden.json`
- `runs/` — gitignored per-run output

## Quickstart: extraction eval

```sh
# 1. Fetch search results once. Commit the resulting fixture.
TAVILY_API_KEY=... node eval/scripts/fetch-search.js \
  --query "standup comedy in russian" \
  --city "New York" \
  --days 90 \
  --search tavily

# 2. Run the LLM extraction against the fixture.
OPENAI_API_KEY=... node eval/scripts/run-extract.js \
  --fixture standup-comedy-in-russian__new-york__90d-from-2026-05-01 \
  --model gpt-4o-mini

# 3. Hand-curate the run output into a golden file. Commit it.
#    (No automated bootstrapping — the golden is human truth.)

# 4. Iterate on src/prompts/extractEvents.js, rerun step 2, watch metrics shift.

# 5. When the new prompt is clearly better and you've reviewed false
#    positives in the latest run, promote it:
node eval/scripts/promote-golden.js \
  --fixture standup-comedy-in-russian__new-york__90d-from-2026-05-01
```

## Adding a new eval kind (e.g. ranking)

1. Add a script under `eval/scripts/run-<kind>.js`.
2. Reuse `eval/core/{slug,fixtures,runs,matching,metrics,report,cli}.js`.
3. Extend `eval/core/metrics.js` with kind-specific metrics if needed (e.g. `topKOverlap`, `rankCorrelation` for ranking).
4. Use a distinct fixture suffix (`<slug>.events.json`, `<slug>.golden-rank.json`) and add helpers to `eval/core/fixtures.js`.
