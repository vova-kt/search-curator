# Eval

Manual-only pipelines for evaluating LLM-driven stages (extract today, rank next) against frozen real-world fixtures, producing a metrics report rather than pass/fail. Lives under [eval/](../eval/), entirely outside the `test/**` glob — `npm test` never picks it up.

## When to run

- After a meaningful change to a prompt, model id, or stage strategy that the LLM influences.
- When iterating on the prompt itself: rerun on the same fixture, compare reports, decide.
- Never on every commit, never in CI. The eval makes paid LLM calls.

## What it is and isn't

- **Is**: a stable lens for comparing prompt variants against the same inputs. The *human* reads the metric report and decides whether a change improved things.
- **Isn't**: a regression test. A `deepEqual` against a golden file would churn the golden on every prompt tweak. `temperature: 0` reduces but doesn't eliminate run-to-run variance, and the model itself drifts as vendors update.

## Layout

```
eval/
  core/        # reusable across eval kinds (slug, fixtures, runs, runKind, matching, metrics, report, ctx, env)
  scripts/     # CLIs: fetch-search, extract/, expand/, promote-golden
  config.js    # parameters per script
  fixtures/    # committed; subfolders per eval kind (search/, extract/, expand/)
  runs/        # gitignored
```

See [eval/core/](../eval/core/) and [eval/scripts/](../eval/scripts/) for what each module does — file names track responsibilities one-to-one. In-tree conventions and "how to add a new eval kind" live in [eval/CLAUDE.md](../eval/CLAUDE.md).

## How scripts are configured

There are no CLI flags. Every script reads its parameters from [eval/config.js](../eval/config.js). The iteration loop is "edit the relevant block, save, run" — no shell-quoting, no flag-name memorization. API keys still come from the environment: run scripts under `node --env-file=.env.dev` so `OPENAI_API_KEY` and friends land in `process.env` without leaking into source.

## Fixture format

`<slug>.search.json` carries everything the extract eval needs to rebuild `ctx.query`:

```jsonc
{
  "slug": "standup-comedy-in-russian__new-york__90d-from-2026-05-01",
  "query": { "city": "New York", "queryText": "standup comedy in russian" },
  "timeframe": { "from": "2026-05-01", "to": "2026-07-30" },
  "fetchedAt": "2026-05-01T14:00:00.000Z",
  "search": { "adapter": "tavily", "queries": ["standup comedy in russian New York"] },
  "hits": [ /* SearchHit[] verbatim from the adapter */ ]
}
```

`<slug>.golden.json` is minimal hand-curated truth; optional fields (description, endsAt, price) are treated as "not asserting." See files under [eval/fixtures/](../eval/fixtures/) for working examples — the JSON shape itself is what's stable, so a fresh fixture is the canonical reference.

## Workflow

Edit the relevant block in [eval/config.js](../eval/config.js) before each step.

1. **Fetch fixture** (once per slug; commit the result). `config.fetchSearch` controls query/city/days/search/expand. `expand: 'templates'` fans out to 4 deterministic phrasings; `expand: 'llm'` uses `llmExpand`; `null` is a single literal search.
   ```sh
   node --env-file=.env.dev eval/scripts/fetch-search.js
   ```
2. **Run extraction**. Set `config.runExtract.fixture` to the slug.
   ```sh
   node --env-file=.env.dev eval/scripts/extract/index.js
   ```
3. **First time**: hand-curate the run JSON into `eval/fixtures/extract/<slug>.golden.json`, commit. Subsequent runs compare against it.
4. **Iterate** on [src/prompts/extractEvents.js](../src/prompts/extractEvents.js), rerun step 2.
5. **Promote** a reviewed run to the new golden once the change is clearly better. Set `config.promoteGolden.fixture`.
   ```sh
   node eval/scripts/promote-golden.js
   ```

## What the metrics measure (and don't)

Defined in [eval/core/metrics.js](../eval/core/metrics.js); field comparators in [eval/core/matching.js](../eval/core/matching.js).

- **Coverage / recall**: golden events matched in the candidate set, by title Jaccard ≥ 0.5.
- **Precision**: candidate events that match a golden event.
- **Field accuracy on matched pairs**: date within ±1 calendar day; venue name normalized substring match. Computed only over matched pairs — doesn't penalize the extractor for missing events; that's recall's job.
- **Hallucination signal**: candidate titles whose tokens don't appear in any source page. **Soft signal** — false positives are common when the LLM rephrases a title, so this is reported separately, not folded into precision.

## Query-expansion eval

[eval/scripts/expand/](../eval/scripts/expand/) calls the `llmExpand` strategy directly with a real LLM, then reports four metrics over the returned queries: golden coverage (against a hand-curated must-have list), pairwise diversity, constraint compliance against the prompt rules in [src/prompts/expandQueries.js](../src/prompts/expandQueries.js), and language coverage against a per-config `expectedLanguages` list (ISO 639-3 codes the city's audience speaks). Language detection uses Unicode-block fast paths for non-Latin scripts and `franc-min` for Latin-script disambiguation, biased toward the expected set so franc's noisy short-text guesses don't wander into irrelevant languages — see [eval/core/queryHeuristics.js](../eval/core/queryHeuristics.js).

The script accepts an array of query configs and dispatches them in parallel, emitting a per-config report plus a generalized aggregate summary (averaged quality, total violations, per-config one-liner) so a single run answers "did this prompt change improve things on average across the test set?".

Fixtures: `<slug>.expand-input.json` (city, queryText, timeframe, optional limit and `nativeLanguageHints`) and `<slug>.expand-golden.json` (`{ queries: string[] }`). Both are hand-authored — there is no fetch step, since the input to expansion is just the query itself. Configure via `config.runExpand`; run with `node --env-file=.env.dev eval/scripts/expand/index.js`.

## Why the eval calls `extract()` directly

`extract(hits, ctx)` ([src/stages/extract.js](../src/stages/extract.js)) is decoupled from discover/dedupe/rank/storage. The eval builds a minimal `ctx` (`{ llm, config, logger, query }`) via [eval/core/ctx.js](../eval/core/ctx.js) and calls the function directly, bypassing the orchestrator. No need for the stub-everything pattern from `test/pipeline_e2e.test.js`.

## Future: ranking eval

Drops into the same skeleton without restructuring:

- `<slug>.events.json` — events to rank
- `<slug>.preferences.json` — likes, dislikes, derivedTraits
- `<slug>.golden-rank.json` — human top-K
- `eval/scripts/run-rank.js` — calls the rank-strategy chain with the real LLM
- `eval/core/metrics.js` grows `topKOverlap` and a rank correlation alongside `matchEvents`

The fixture/script/report layout, gating, slug scheme, and run-record format stay identical.
