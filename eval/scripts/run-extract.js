#!/usr/bin/env node
/**
 * run-extract.js — the extraction eval.
 *
 * Loads `<slug>.search.json`, calls `extract(hits, ctx)` directly with a real
 * LLM, and renders a metric report against `<slug>.golden.json` (if present).
 * Writes the run record to `eval/runs/<slug>__<ts>.json` for offline diffing.
 *
 * The eval calls the extract stage in isolation — no discover/dedupe/rank/
 * storage. See [src/stages/extract.js](../../src/stages/extract.js).
 *
 * Usage:
 *   node eval/scripts/run-extract.js --fixture <slug> [--model <id>] [--temperature 0]
 */

import { resolve } from 'node:path';
import { extract } from '../../src/stages/extract.js';
import { parseArgs, requireString, requireEnv } from '../core/cli.js';
import { loadSearchFixture, loadGoldenFixture } from '../core/fixtures.js';
import { writeRun, gitShaOf } from '../core/runs.js';
import { buildExtractCtx } from '../core/ctx.js';
import {
  matchEvents,
  precisionRecall,
  fieldAccuracy,
  hallucinationSignal,
} from '../core/metrics.js';
import { ratio, eventList, compose } from '../core/report.js';

const args = parseArgs(process.argv.slice(2));

try {
  const slug = requireString(args, 'fixture');
  const model = typeof args.model === 'string' ? args.model : 'gpt-4o-mini';
  const temperature =
    typeof args.temperature === 'string' ? Number(args.temperature) : 0;
  const apiKey = requireEnv('OPENAI_API_KEY');

  const fixture = loadSearchFixture(slug);
  const golden = loadGoldenFixture(slug);

  console.log(
    `extract eval — ${slug}\n  model: ${model}  temperature: ${temperature}  hits: ${fixture.hits.length}`,
  );

  const ctx = buildExtractCtx({
    query: {
      city: fixture.query.city,
      queryText: fixture.query.queryText,
      timeframe: fixture.timeframe,
    },
    model,
    apiKey,
    temperature,
  });

  const t0 = Date.now();
  const events = await extract(fixture.hits, ctx);
  const elapsedMs = Date.now() - t0;
  console.log(`extracted ${events.length} events in ${(elapsedMs / 1000).toFixed(1)}s`);

  const promptPath = resolve(
    new URL('../../src/prompts/extractEvents.js', import.meta.url).pathname,
  );

  const report = golden
    ? buildReport({ candidate: events, golden: golden.events, hits: fixture.hits })
    : buildBootstrapReport({ candidate: events, hits: fixture.hits });

  console.log('\n' + report.text + '\n');

  const runPath = writeRun({
    slug,
    kind: 'extract',
    llm: { provider: 'openai', model, temperature },
    promptHashes: { 'extractEvents.js': gitShaOf(promptPath) },
    output: events,
    report: report.data,
  });
  console.log(`run saved: ${runPath}`);

  if (!golden) {
    console.log(
      `\nno golden file yet. Hand-curate the run output, save as ` +
        `eval/fixtures/${slug}.golden.json, then rerun for a real metrics report.`,
    );
  }
} catch (err) {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
}

/**
 * @param {{ candidate: import('../../src/core/types.js').Event[],
 *           golden: import('../core/fixtures.js').GoldenEvent[],
 *           hits: import('../../src/core/types.js').SearchHit[] }} args
 */
function buildReport({ candidate, golden, hits }) {
  const m = matchEvents(golden, candidate);
  const pr = precisionRecall(m, golden.length, candidate.length);
  const fa = fieldAccuracy(m);
  const halluc = hallucinationSignal(candidate, hits);

  const text = compose([
    'metrics',
    [
      ratio('coverage (recall)', pr.tp, pr.goldenCount),
      ratio('precision', pr.tp, pr.candidateCount, `f1=${pr.f1.toFixed(3)}`),
    ].join('\n'),
    `field accuracy on matched pairs (n=${fa.n})\n` +
      [ratio('date within ±1 day', Math.round(fa.date * fa.n), fa.n),
       ratio('venue match', Math.round(fa.venue * fa.n), fa.n)].join('\n'),
    eventList('unmatched golden (missed)', golden, m.unmatchedGolden),
    eventList('unmatched candidate (false positives)', candidate, m.unmatchedCandidate),
    halluc.length > 0
      ? `hallucination signal (${halluc.length}):\n` +
        halluc.map((h) => `  - "${h.title}"`).join('\n')
      : 'hallucination signal: none',
  ]);

  return { text, data: { precisionRecall: pr, fieldAccuracy: fa, match: m, hallucination: halluc } };
}

/**
 * @param {{ candidate: import('../../src/core/types.js').Event[],
 *           hits: import('../../src/core/types.js').SearchHit[] }} args
 */
function buildBootstrapReport({ candidate, hits }) {
  const halluc = hallucinationSignal(candidate, hits);
  const text = compose([
    `bootstrap (no golden) — ${candidate.length} candidate events`,
    eventList('candidates', candidate, candidate.map((_, i) => i)),
    halluc.length > 0
      ? `hallucination signal (${halluc.length}):\n` +
        halluc.map((h) => `  - "${h.title}"`).join('\n')
      : 'hallucination signal: none',
  ]);
  return { text, data: { hallucination: halluc } };
}
