# Eval

Manual-only pipelines for evaluating LLM-driven stages (extract today, rank next) against frozen real-world fixtures, producing a metrics report rather than pass/fail. Lives under [eval/](../eval/), entirely outside the `test/**` glob — `npm test` never picks it up.

## When to run

- After a meaningful change to a prompt, model id, or stage strategy that the LLM influences.
- When iterating on the prompt itself: rerun on the same fixture, compare reports, decide.
- Never on every commit, never in CI. The eval makes paid LLM calls.

## What the eval is and isn't

- **Is**: a stable lens for comparing prompt variants against the same inputs. The *human* reads the metric report and decides whether a change improved things.
- **Isn't**: a regression test. Strict deepEqual against a golden file would churn the golden on every prompt tweak. `temperature: 0` reduces but doesn't eliminate run-to-run variance.

## Layout

```
eval/
  core/        # reusable across eval kinds
    slug.js          # fixture key from (queryText, city, days, fromDate)
    fixtures.js      # load/save .search.json and .golden.json
    runs.js          # writes per-invocation run records to eval/runs/
    matching.js      # title/date/venue match primitives
    metrics.js       # matchEvents, precisionRecall, fieldAccuracy, hallucinationSignal
    report.js        # stdout report rendering
    ctx.js           # buildExtractCtx — minimal Ctx for direct stage calls
    cli.js           # tiny argv parser
  scripts/     # CLIs
    fetch-search.js     # adapter -> .search.json
    run-extract.js      # .search.json + .golden.json -> report
    promote-golden.js   # reviewed run -> .golden.json
  fixtures/    # committed
  runs/        # gitignored
```

## Fixture format

`<slug>.search.json` — self-describing, carries everything `run-extract.js` needs to rebuild `ctx.query`:

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

`<slug>.golden.json` — minimal hand-curated truth. Optional fields (description, endsAt, price) are treated as "not asserting":

```jsonc
{
  "slug": "...",
  "events": [
    { "title": "...", "startsAt": "2026-05-12T20:00:00-04:00",
      "venue": { "name": "...", "city": "New York" }, "source": { "url": "https://..." } }
  ]
}
```

## Workflow

```sh
# 1. Fetch fixture (once per slug; commit the result).
TAVILY_API_KEY=... node eval/scripts/fetch-search.js \
  --query "standup comedy in russian" --city "New York" --days 90 --search tavily

# 2. Run extraction.
OPENAI_API_KEY=... node eval/scripts/run-extract.js --fixture <slug>

# 3. First time: hand-curate the run JSON into a golden file, save as
#    eval/fixtures/<slug>.golden.json, commit. Subsequent runs compare against it.

# 4. Iterate on src/prompts/extractEvents.js, rerun step 2.

# 5. Promote a reviewed run to the new golden once the change is clearly better.
node eval/scripts/promote-golden.js --fixture <slug>
```

## Metrics

Defined in [eval/core/metrics.js](../eval/core/metrics.js). Field comparators in [eval/core/matching.js](../eval/core/matching.js).

- **Coverage / recall**: golden events matched in the candidate set, by title Jaccard ≥ 0.5.
- **Precision**: candidate events that match a golden event.
- **Field accuracy on matched pairs**: date within ±1 calendar day; venue name normalized substring match. Computed only over matched pairs — doesn't penalize the extractor for missing events; that's recall's job.
- **Hallucination signal**: candidate titles whose tokens don't appear in any source page. Soft signal, *not* part of precision/recall — false positives are common when the LLM rephrases a title.

## Why the eval calls `extract()` directly

`extract(hits, ctx)` ([src/stages/extract.js](../src/stages/extract.js)) is decoupled from discover/dedupe/rank/storage. The eval builds a minimal `Ctx` (`{ llm, config, logger, query }`) via [eval/core/ctx.js](../eval/core/ctx.js) and calls the function directly. No need for the stub-everything pattern from `test/pipeline_e2e.test.js`.

## Future: ranking eval

Drops into the same skeleton without restructuring:

- `<slug>.events.json` — events to rank
- `<slug>.preferences.json` — likes, dislikes, derivedTraits
- `<slug>.golden-rank.json` — human top-K
- `eval/scripts/run-rank.js` — calls the rank-strategy chain with the real LLM
- `eval/core/metrics.js` grows `topKOverlap` and a rank-correlation alongside `matchEvents`

The fixture/script/report layout, gating, slug scheme, and run-record format stay identical.
