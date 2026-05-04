#!/usr/bin/env node
/**
 * extract quality × cost analysis — runs the extract eval across multiple models
 * and renders a comparison report of quality metrics, token usage, and cost.
 *
 * All models run concurrently (Promise.allSettled); fixtures within each model
 * also run concurrently.
 *
 * Configure MODELS / TEMPERATURE below, then run:
 *   node --env-file=.env.dev eval/scripts/extract/analyse.js
 */

import { calculateCost, MODEL_PRICING } from '../../../src/core/pricing.js';
import { extract } from '../../../src/stages/extract.js';
import { requireEnv } from '../../core/env.js';
import {
  listSearchSlugs,
  loadSearchFixture,
  loadGoldenFixture,
} from '../../core/fixtures.js';
import {
  matchEvents,
  precisionRecall,
  fieldAccuracy,
  hallucinationSignal,
} from '../../core/metrics.js';
import { resolve } from 'node:path';
import { writeRun, gitShaOf } from '../../core/runs.js';
import { RunKind } from '../../core/runKind.js';
import { section } from './helpers.js';
import { createEvalContext } from '../../core/ctx.js';

/**
 * @typedef {Object} ModelResult
 * @property {string} model
 * @property {number} recall
 * @property {number} precision
 * @property {number} f1
 * @property {number} dateAcc
 * @property {number} venueAcc
 * @property {number} hallucination
 * @property {import("../../../src/core/pricing.js").CostBreakdown?} cost
 * @property {number} elapsedMs
 * @property {number} errors
 */

const MODELS = [
  'gpt-5.4-mini',
  'gpt-5.4',
  'gpt-5-mini',
  'gpt-4o-mini',
];

const TEMPERATURE = 0;

const REASONING_MODELS = new Set(['gpt-5-mini', 'gpt-5-nano', 'gpt-5']);

/** @param {string} model */
function temperatureFor(model) {
  return REASONING_MODELS.has(model) ? 1 : TEMPERATURE;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

try {
  const apiKey = requireEnv('OPENAI_API_KEY');
  const slugs = listSearchSlugs().filter((slug) => slug.includes('berlin'));

  if (slugs.length === 0) {
    console.log('no *.search.json fixtures found');
    process.exit(0);
  }

  const fixtures = slugs.map((slug) => ({
    slug,
    search: loadSearchFixture(slug),
    golden: loadGoldenFixture(slug),
  }));

  const evaluated = fixtures.filter((f) => f.golden);
  if (evaluated.length === 0) {
    console.log('no golden files — run eval/scripts/extract/index.js first to bootstrap');
    process.exit(0);
  }

  console.log(
    `extract quality × cost — ${MODELS.length} models × ${evaluated.length} fixture(s), temperature ${TEMPERATURE}\n`,
  );

  const promptPath = resolve(
    new URL('../../../src/prompts/extractEvents.js', import.meta.url).pathname,
  );
  const promptSha = gitShaOf(promptPath);

  let done = 0;

  /** @param {string} model @returns {Promise<ModelResult>} */
  async function runModel(model) {
    const start = Date.now();
    const slugResults = await Promise.allSettled(
      evaluated.map(async (f) => {
        const query = {
          city: f.search.query.city,
          queryText: f.search.query.queryText,
          timeframe: f.search.timeframe,
        };
        const ctx = createEvalContext({
          apiKey,
        });
        if (f.golden == null) throw new Error(`no golden for ${f.slug}`);

        const { events, usage } = await extract(f.search.hits, ctx, query);
        const golden = f.golden.events;
        const matchResult = matchEvents(golden, events);
        const precision = precisionRecall(matchResult, golden.length, events.length);
        const accuracy = fieldAccuracy(matchResult);
        const hallucination = hallucinationSignal(events, f.search.hits);
        const temp = temperatureFor(model);

        writeRun({
          slug: `${model}__${f.slug}`,
          kind: RunKind.EXTRACT,
          llm: { provider: 'openai', model, temperature: temp },
          promptHashes: { 'extractEvents.js': promptSha },
          output: events,
          report: {
            precisionRecall: precision,
            fieldAccuracy: accuracy,
            match: matchResult,
            hallucination: hallucination.length,
          },
        });

        return { pr: precision, fa: accuracy, hallucination: hallucination.length, usage };
      }),
    );
    const elapsedMs = Date.now() - start;

    const fulfilled = slugResults
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value);
    const errors = slugResults.filter((r) => r.status === 'rejected').length;

    const totalUsage = fulfilled.map((r) => r.usage);
    const cost = calculateCost(model, totalUsage);

    let tp = 0,
      goldenCount = 0,
      candidateCount = 0;
    let dateOk = 0,
      venueOk = 0,
      matchedN = 0;
    let hallucination = 0;

    for (const sr of fulfilled) {
      tp += sr.pr.tp;
      goldenCount += sr.pr.goldenCount;
      candidateCount += sr.pr.candidateCount;
      dateOk += Math.round(sr.fa.date * sr.fa.n);
      venueOk += Math.round(sr.fa.venue * sr.fa.n);
      matchedN += sr.fa.n;
      hallucination += sr.hallucination;
    }

    const recall = goldenCount === 0 ? 0 : tp / goldenCount;
    const precision = candidateCount === 0 ? 0 : tp / candidateCount;
    const f1 =
      precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    const dateAcc = matchedN === 0 ? 0 : dateOk / matchedN;
    const venueAcc = matchedN === 0 ? 0 : venueOk / matchedN;

    const errSuffix = errors > 0 ? ` (${errors} err)` : '';
    console.log(`  [${++done}/${MODELS.length}] ${model.padEnd(18)} ${(elapsedMs / 1000).toFixed(1)}s${errSuffix}`);

    return {
      model,
      recall,
      precision,
      f1,
      dateAcc,
      venueAcc,
      hallucination,
      cost,
      elapsedMs,
      errors,
    };
  }

  const settled = await Promise.allSettled(MODELS.map(runModel));
  /** @type {ModelResult[]} */
  const results = [];
  for (let i = 0; i < MODELS.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled') {
      results.push(r.value);
    } else {
      console.error(`  FAIL  ${MODELS[i]}: ${r.reason}`);
    }
  }

  console.log('');
  renderReport(results);
} catch (err) {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
}

/* ── report rendering ─────────────────────────────────────────────── */

/** @param {ModelResult[]} results */
function renderReport(results) {
  const hdr =
    'model'.padEnd(18) +
    'recall'.padStart(8) +
    'prec'.padStart(8) +
    'f1'.padStart(8) +
    'date'.padStart(7) +
    'venue'.padStart(7) +
    'hal'.padStart(5) +
    'inTok'.padStart(9) +
    'outTok'.padStart(9) +
    'cost$'.padStart(9) +
    'time'.padStart(8);
  const sep = '─'.repeat(hdr.length);

  console.log(section('quality × cost', results.length));
  console.log('  ' + hdr);
  console.log('  ' + sep);

  for (const r of results) {
    const costStr = r.cost?.totalCost.toFixed(1) ?? 'n/a';
    const time = (r.elapsedMs / 1000).toFixed(1) + 's';
    const errTag = r.errors > 0 ? `(${r.errors}err)` : '';

    console.log(
      '  ' +
        r.model.padEnd(18) +
        r.recall.toFixed(3).padStart(8) +
        r.precision.toFixed(3).padStart(8) +
        r.f1.toFixed(3).padStart(8) +
        r.dateAcc.toFixed(3).padStart(7) +
        r.venueAcc.toFixed(3).padStart(7) +
        String(r.hallucination).padStart(5) +
        String(r.cost?.inputTokens).padStart(9) +
        String(r.cost?.outputTokens).padStart(9) +
        costStr.padStart(9) +
        (time + errTag).padStart(8),
    );
  }

  console.log('  ' + sep);

  const model = results[0].model;
  const usage = results.map(r => r.cost)
  // @ts-ignore
  const cost = calculateCost(model, usage)
  const totalTime = results.reduce((s, r) => s + r.elapsedMs, 0);
  console.log(
    `  totals: ${cost?.inputTokens} input + ${cost?.outputTokens} output tokens, $${cost?.totalCost.toFixed(4)}, ${(totalTime / 1000).toFixed(1)}s`,
  );

  renderPricing(results);
  renderInsights(results);
}

/** @param {ModelResult[]} results */
function renderPricing(results) {
  console.log(section('pricing reference (USD / 1M tokens)', 0));
  console.log(
    '  ' + 'model'.padEnd(18) + 'input'.padStart(8) + 'output'.padStart(9),
  );
  for (const r of results) {
    const p = MODEL_PRICING[r.model];
    if (!p) continue;
    console.log(
      '  ' +
        r.model.padEnd(18) +
        ('$' + p.input.toFixed(2)).padStart(8) +
        ('$' + p.output.toFixed(2)).padStart(9),
    );
  }
}

/** @param {ModelResult[]} results */
function renderInsights(results) {
  const valid = results.filter((r) => r.errors === 0 && r.cost);
  if (valid.length === 0) return;

  const bestQuality = valid.reduce((a, b) => (a.f1 > b.f1 ? a : b));
  const cheapest = valid.reduce((a, b) =>
    (a.cost?.totalCost ?? Infinity) < (b.cost?.totalCost ?? Infinity) ? a : b,
  );
  const bestValue = valid.reduce((a, b) => {
    const aVal = a.cost?.totalCost ? a.f1 / a.cost.totalCost : 0;
    const bVal = b.cost?.totalCost ? b.f1 / b.cost.totalCost : 0;
    return aVal > bVal ? a : b;
  });

  console.log(section('insights', 0));
  console.log(
    `  → best quality:  ${bestQuality.model.padEnd(16)} f1=${bestQuality.f1.toFixed(3)}  $${bestQuality.cost?.totalCost.toFixed(4)}`,
  );
  console.log(
    `  → cheapest:      ${cheapest.model.padEnd(16)} f1=${cheapest.f1.toFixed(3)}  $${cheapest.cost?.totalCost.toFixed(4)}`,
  );

  if (bestValue !== bestQuality && bestValue !== cheapest) {
    console.log(
      `  → best value:    ${bestValue.model.padEnd(16)} f1=${bestValue.f1.toFixed(3)}  $${bestValue.cost?.totalCost.toFixed(4)}`,
    );
  }

  if (bestQuality !== cheapest && bestQuality.cost && cheapest.cost) {
    const costPct = ((cheapest.cost.totalCost / bestQuality.cost.totalCost) * 100).toFixed(0);
    const f1Delta = bestQuality.f1 - cheapest.f1;
    const dir = f1Delta > 0 ? '-' : '+';
    console.log(
      `  → trade-off: cheapest is ${costPct}% the cost of best quality, ${dir}${Math.abs(f1Delta).toFixed(3)} f1`,
    );
  }
}
