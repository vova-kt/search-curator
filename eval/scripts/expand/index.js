#!/usr/bin/env node
/**
 * expand eval — query-expansion evaluation.
 *
 * Calls the `llmExpand` strategy with a real LLM and renders metric reports
 * against `<slug>.expand-golden.json` when present.
 *
 * Two modes controlled by the GRID array:
 *   - **Single variation** (1 entry): detailed per-config reports, aggregate
 *     summary, run files, and a cost/usage footer.
 *   - **Grid sweep** (multiple entries): compact progress output followed by a
 *     cost/quality comparison table across all variations.
 *
 * Configure MODELS / TEMPERATURES / LIMITS below, then run:
 *   node --env-file=.env.dev eval/scripts/expand/index.js
 */

import { resolve } from 'node:path';
import { calculateCost } from '../../../src/core/pricing.js';
import { requireEnv } from '../../core/env.js';
import { gitShaOf } from '../../core/runs.js';
import { timeframeOf } from './helpers.js';
import { runOne } from './runner.js';
import { buildAggregateReport } from './report.js';
import { renderGridReport } from './grid.js';

/** @typedef {import('./types.js').ExpandConfig} ExpandConfig */
/** @typedef {import('./types.js').Variation} Variation */
/** @typedef {import('./types.js').VariationResult} VariationResult */

/* ------------------------------------------------------------------ */
/*  Grid — edit to sweep across model / temperature / limit            */
/* ------------------------------------------------------------------ */

const MODELS = ['gpt-5.4-nano', 'gpt-5.4-mini', 'gpt-5.4'];
const TEMPERATURES = [0.0, 0.3, 0.7];
const LIMITS = [5, 8, 12];

/** @type {Variation[]} */
const GRID = MODELS.flatMap((model) =>
  TEMPERATURES.flatMap((temperature) =>
    LIMITS.map((limit) => ({ model, temperature, limit })),
  ),
);

/* ------------------------------------------------------------------ */
/*  Query configs                                                      */
/* ------------------------------------------------------------------ */

/** @type {ExpandConfig[]} */
const configs = [
  {
    query: { queryText: 'russian standup', city: 'berlin', timeframe: timeframeOf(0, 30) },
    expectedLanguages: ['rus', 'deu', 'eng'],
  },
  {
    query: { queryText: 'jazz concert', city: 'new york', timeframe: timeframeOf(0, 7) },
    expectedLanguages: ['eng'],
  },
  {
    query: { queryText: 'tech meetup ai', city: 'san francisco', timeframe: timeframeOf(0, 14) },
    expectedLanguages: ['eng'],
  },
  {
    query: { queryText: 'contemporary art exhibition', city: 'paris', timeframe: timeframeOf(7, 120) },
    expectedLanguages: ['fra', 'eng'],
  },
  {
    query: { queryText: 'street food festival', city: 'bangkok', timeframe: timeframeOf(0, 21) },
    expectedLanguages: ['tha', 'eng'],
  },
  {
    query: { queryText: 'startup pitch night', city: 'london', timeframe: timeframeOf(0, 75) },
    expectedLanguages: ['eng'],
  },
  {
    query: { queryText: 'marathon half-marathon', city: 'tokyo', timeframe: timeframeOf(14, 90) },
    expectedLanguages: ['jpn', 'eng'],
  },
  {
    query: { queryText: 'indie film screening', city: 'amsterdam', timeframe: timeframeOf(0, 14) },
    expectedLanguages: ['nld', 'eng'],
  },
  {
    query: { queryText: 'yoga retreat weekend', city: 'lisbon', timeframe: timeframeOf(7, 45) },
    expectedLanguages: ['por', 'eng'],
  },
  {
    query: { queryText: 'salsa bachata social', city: 'barcelona', timeframe: timeframeOf(0, 10) },
    expectedLanguages: ['spa', 'cat', 'eng'],
  },
];

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

try {
  const apiKey = requireEnv('OPENAI_API_KEY');
  const promptPath = resolve(
    new URL('../../../src/prompts/expandQueries.js', import.meta.url).pathname,
  );
  const promptSha = gitShaOf(promptPath);
  const isGrid = GRID.length > 1;

  if (isGrid) {
    console.log(
      `expand grid eval — ${GRID.length} variations × ${configs.length} configs = ${GRID.length * configs.length} LLM calls\n`,
    );
  } else {
    console.log(`expand eval — ${configs.length} config(s)\n`);
  }

  /** @type {VariationResult[]} */
  const variationResults = [];

  for (const variation of GRID) {
    const { model, temperature, limit } = variation;
    if (isGrid) {
      process.stdout.write(`  ${model} t=${temperature} l=${limit} ...`);
    }

    const start = Date.now();
    const results = await Promise.all(
      configs.map(async (cfg) => {
        try {
          return await runOne(cfg, {
            apiKey,
            model,
            temperature,
            limit,
            promptSha,
            writeRunRecord: !isGrid,
          });
        } catch (err) {
          throw err;
        }
      }),
    );
    const elapsedMs = Date.now() - start;
    const usage = results.map((r) => r.usage);
    const cost = calculateCost(model, usage.filter((u) => u != null));

    if (isGrid) {
      const errors = results.filter((r) => r.error).length;
      console.log(
        ` ${(elapsedMs / 1000).toFixed(1)}s ${errors ? errors + ' errors' : 'ok'}`,
      );
    }

    variationResults.push({
      variation,
      results,
      elapsedMs,
      cost,
    });
  }

  if (!isGrid) {
    const { variation, results, cost } = variationResults[0];
    for (const r of results) {
      console.log(`=== ${r.slug} ===`);
      console.log(
        `model: ${variation.model}  city: ${r.config.query.city}  query: "${r.config.query.queryText}"  timeframe: ${r.config.query.timeframe.from}→${r.config.query.timeframe.to}`,
      );
      console.log(
        `expanded to ${r.queries.length} queries in ${(r.elapsedMs / 1000).toFixed(1)}s`,
      );
      console.log('\n' + r.report?.text + '\n');
      console.log(`run saved: ${r.runPath}`);
      if (!r.golden) {
        console.log(
          `\nno golden file yet. Hand-curate a list of must-have phrasings, save as ` +
            `eval/fixtures/expand/${r.slug}.expand-golden.json with shape ` +
            `{ "slug": "${r.slug}", "queries": [...] }.`,
        );
      }
      console.log();
    }

    if (results.length > 1) {
      console.log('=== aggregate (' + results.length + ' configs) ===');
      console.log(buildAggregateReport(results) + '\n');
    }

    console.log(`usage: ${cost.inputTokens} input + ${cost.outputTokens} output tokens`);
    if (cost) {
      console.log(
        `cost: $${cost.totalCost.toFixed(4)} (input: $${cost.inputCost.toFixed(4)}, output: $${cost.outputCost.toFixed(4)})`,
      );
    }
  } else {
    console.log('\n' + renderGridReport(variationResults, configs.length));
  }
} catch (err) {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
}
