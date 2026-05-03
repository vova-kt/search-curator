#!/usr/bin/env node
/**
 * run-expand.js — the query-expansion eval.
 *
 * Loads `<slug>.expand-input.json`, calls the `llmExpand` strategy directly
 * with a real LLM, and renders a metric report against
 * `<slug>.expand-golden.json` (a hand-curated list of "must-have" query
 * phrasings) when present. Writes the run record to
 * `eval/runs/<slug>__<ts>.json` for offline diffing.
 *
 * Multiple query configs are dispatched in parallel; each gets its own report
 * and run file, plus a generalized aggregate summary at the end.
 *
 * The eval calls the strategy in isolation — no discover/search/extract.
 * See [src/strategies/queryExpansion/llmExpand.js](../../src/strategies/queryExpansion/llmExpand.js).
 *
 * Configure in [eval/config.js](../config.js) → `runExpand`. Run:
 *   node --env-file=.env.dev eval/scripts/run-expand.js
 */

import { resolve } from 'node:path';
import { llmExpand } from '../../src/strategies/queryExpansion/index.js';
import { requireEnv } from '../core/env.js';
import { loadExpandGoldenFixture } from '../core/fixtures.js';
import { writeRun, gitShaOf } from '../core/runs.js';
import { RunKind } from '../core/runKind.js';
import { buildExpandCtx } from '../core/ctx.js';
import {
  goldenQueryCoverage,
  queryDiversity,
  constraintCompliance,
  expectedLanguageCoverage,
} from '../core/metrics.js';
import { hasMonthYearAnchor, hasBadTimeRef } from '../core/queryHeuristics.js';
import { ratio, compose } from '../core/report.js';


/**
 * Build a timeframe `{ from, to }` window starting `startOffsetDays` from today
 * and lasting `windowDays`.
 * @param {number} startOffsetDays
 * @param {number} windowDays
 */
function timeframeOf(startOffsetDays, windowDays) {
  const from = new Date(Date.now() + startOffsetDays * 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + (startOffsetDays + windowDays) * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

/**
 * @typedef {{
 *   model: string,
 *   query: { queryText: string, city: string, timeframe: { from: string, to: string } },
 *   expectedLanguages: string[],   // ISO 639-3 codes the city's audience speaks
 *   limit: number,
 *   temperature: number,
 * }} ExpandConfig
 */

const MODEL = 'gpt-5.4-mini';
const LIMIT = 8;
const TEMPERATURE = 0.1;

/** @type {ExpandConfig[]} */
const configs = [
  {
    model: MODEL,
    query: { queryText: 'russian standup', city: 'berlin', timeframe: timeframeOf(0, 30) },
    expectedLanguages: ['rus', 'deu', 'eng'],
    limit: LIMIT,
    temperature: TEMPERATURE,
  },
  {
    model: MODEL,
    query: { queryText: 'jazz concert', city: 'new york', timeframe: timeframeOf(0, 7) },
    expectedLanguages: ['eng'],
    limit: LIMIT,
    temperature: TEMPERATURE,
  },
  {
    model: MODEL,
    query: { queryText: 'tech meetup ai', city: 'san francisco', timeframe: timeframeOf(0, 14) },
    expectedLanguages: ['eng'],
    limit: LIMIT,
    temperature: TEMPERATURE,
  },
  {
    model: MODEL,
    query: { queryText: 'contemporary art exhibition', city: 'paris', timeframe: timeframeOf(7, 120) },
    expectedLanguages: ['fra', 'eng'],
    limit: LIMIT,
    temperature: TEMPERATURE,
  },
  {
    model: MODEL,
    query: { queryText: 'street food festival', city: 'bangkok', timeframe: timeframeOf(0, 21) },
    expectedLanguages: ['tha', 'eng'],
    limit: LIMIT,
    temperature: TEMPERATURE,
  },
  {
    model: MODEL,
    query: { queryText: 'startup pitch night', city: 'london', timeframe: timeframeOf(0, 75) },
    expectedLanguages: ['eng'],
    limit: LIMIT,
    temperature: TEMPERATURE,
  },
  {
    model: MODEL,
    query: { queryText: 'marathon half-marathon', city: 'tokyo', timeframe: timeframeOf(14, 90) },
    expectedLanguages: ['jpn', 'eng'],
    limit: LIMIT,
    temperature: TEMPERATURE,
  },
  {
    model: MODEL,
    query: { queryText: 'indie film screening', city: 'amsterdam', timeframe: timeframeOf(0, 14) },
    expectedLanguages: ['nld', 'eng'],
    limit: LIMIT,
    temperature: TEMPERATURE,
  },
  {
    model: MODEL,
    query: { queryText: 'yoga retreat weekend', city: 'lisbon', timeframe: timeframeOf(7, 45) },
    expectedLanguages: ['por', 'eng'],
    limit: LIMIT,
    temperature: TEMPERATURE,
  },
  {
    model: MODEL,
    query: { queryText: 'salsa bachata social', city: 'barcelona', timeframe: timeframeOf(0, 10) },
    expectedLanguages: ['spa', 'cat', 'eng'],
    limit: LIMIT,
    temperature: TEMPERATURE,
  },
];


try {
  const apiKey = requireEnv('OPENAI_API_KEY');
  const promptPath = resolve(
    new URL('../../src/prompts/expandQueries.js', import.meta.url).pathname,
  );
  const promptSha = gitShaOf(promptPath);

  console.log(`expand eval — ${configs.length} config(s)\n`);

  const results = await Promise.all(configs.map((cfg) => runOne(cfg, { apiKey, promptSha })));

  for (const r of results) {
    console.log(`=== ${r.slug} ===`);
    console.log(`model: ${r.config.model}  city: ${r.config.query.city}  query: "${r.config.query.queryText}"  timeframe: ${r.config.query.timeframe.from}→${r.config.query.timeframe.to}`);
    console.log(`expanded to ${r.queries.length} queries in ${(r.elapsedMs / 1000).toFixed(1)}s`);
    console.log('\n' + r.report.text + '\n');
    console.log(`run saved: ${r.runPath}`);
    if (!r.golden) {
      console.log(
        `\nno golden file yet. Hand-curate a list of must-have phrasings, save as ` +
          `eval/fixtures/${r.slug}.expand-golden.json with shape ` +
          `{ "slug": "${r.slug}", "queries": [...] }.`,
      );
    }
    console.log();
  }

  if (results.length > 1) {
    console.log('=== aggregate (' + results.length + ' configs) ===');
    console.log(buildAggregateReport(results) + '\n');
  }
} catch (err) {
  console.error(err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
}

/**
 * @param {ExpandConfig} config
 * @param {{ apiKey: string, promptSha: string }} env
 */
async function runOne(config, { apiKey, promptSha }) {
  const slug = `${config.model}-${config.query.queryText}-${config.query.city}`;
  const golden = loadExpandGoldenFixture(slug);

  const start = Date.now();
  const ctx = buildExpandCtx({
    query: config.query,
    apiKey,
    model: config.model,
    limit: config.limit,
    temperature: config.temperature,
  });
  const queries = await llmExpand()(ctx);
  const elapsedMs = Date.now() - start;

  const report = buildReport({
    candidate: queries,
    golden: golden?.queries ?? null,
    expectedLanguages: config.expectedLanguages,
  });

  const runPath = writeRun({
    slug,
    kind: RunKind.EXPAND,
    llm: { provider: 'openai', model: config.model, temperature: ctx.config.queryExpansion.temperature },
    promptHashes: { 'expandQueries.js': promptSha },
    output: queries,
    report: report.data,
  });

  return { config, slug, queries, golden, elapsedMs, report, runPath };
}

/**
 * @param {{ candidate: string[], golden: string[] | null, expectedLanguages: string[] }} args
 */
function buildReport({ candidate, golden, expectedLanguages }) {
  const div = queryDiversity(candidate);
  const cc = constraintCompliance(candidate);
  const lc = expectedLanguageCoverage(candidate, expectedLanguages);
  const cov = golden ? goldenQueryCoverage(golden, candidate) : null;
  const monthYearCount = candidate.filter(hasMonthYearAnchor).length;
  const badTimeRefs = candidate.filter(hasBadTimeRef);

  const sections = [
    'metrics',
    cov
      ? ratio('golden coverage', cov.matched.length, cov.goldenCount)
      : 'golden coverage: (no golden fixture)',
    `diversity (avg pairwise token-Jaccard distance, ${div.pairs} pairs)\n` +
      `  avg=${div.avgDistance.toFixed(3)}  min=${div.minDistance.toFixed(3)}`,
    `constraint compliance (${cc.total} queries)\n` +
      [
        ratio('  too long (>80c)',     cc.tooLong.length,     cc.total),
        ratio('  boolean operators',   cc.booleanOps.length,  cc.total),
        ratio('  quoted phrases',      cc.quoted.length,      cc.total),
        ratio('  site: filters',       cc.siteFilter.length,  cc.total),
        ratio('  duplicates',          cc.duplicates.length,  cc.total),
      ].join('\n'),
    `language coverage (expected: ${expectedLanguages.join(', ')})\n` +
      [
        ratio('  in expected', lc.matched, lc.total),
        ratio('  unexpected',  lc.unexpected, lc.total),
        ...Object.entries(lc.distribution).map(([k, n]) => ratio(`  ${k}`, n, lc.total)),
      ].join('\n'),
    ratio('month-year anchored', monthYearCount, candidate.length),
    badTimeRefs.length > 0
      ? `BAD time refs (specific dates / day-of-week / relative day — should be 0):\n` +
        badTimeRefs.map((q) => `  ! ${q}`).join('\n')
      : 'specific-date/day-of-week refs: none (good)',
    queryList('output queries', candidate),
    cov && cov.unmatchedGolden.length > 0
      ? queryList('unmatched golden (missed phrasings)', cov.unmatchedGolden.map((i) => golden[i]))
      : null,
  ];

  return {
    text: compose(sections),
    data: {
      diversity: div,
      constraintCompliance: cc,
      languageCoverage: lc,
      monthYearCount,
      badTimeRefCount: badTimeRefs.length,
      ...(cov ? { goldenCoverage: cov } : {}),
    },
  };
}

/**
 * Generalized cross-config summary. Aggregates the per-config report data
 * into averages (quality signals) and totals (violation counts) so a single
 * glance answers "did this prompt change improve things on average?".
 *
 * @param {Awaited<ReturnType<typeof runOne>>[]} results
 */
function buildAggregateReport(results) {
  const n = results.length;
  const totalQueries = sum(results.map((r) => r.queries.length));
  const avgPerConfig = totalQueries / n;

  const withGolden = results.filter((r) => r.report.data.goldenCoverage);
  const avgCoverage = withGolden.length === 0
    ? null
    : avg(withGolden.map((r) => r.report.data.goldenCoverage.coverage));

  const avgDiversity = avg(results.map((r) => r.report.data.diversity.avgDistance));
  const minDiversity = Math.min(...results.map((r) => r.report.data.diversity.minDistance));

  const violations = (cc) =>
    cc.tooLong.length + cc.booleanOps.length + cc.quoted.length + cc.siteFilter.length + cc.duplicates.length;
  const totalViolations = sum(results.map((r) => violations(r.report.data.constraintCompliance)));
  const totalBadTime = sum(results.map((r) => r.report.data.badTimeRefCount));
  const totalMonthYear = sum(results.map((r) => r.report.data.monthYearCount));
  const avgLangCoverage = avg(results.map((r) => r.report.data.languageCoverage.coverage));

  const perConfig = results
    .map((r) => {
      const cov = r.report.data.goldenCoverage;
      const v = violations(r.report.data.constraintCompliance);
      return (
        `  - ${r.slug}` +
        `  n=${r.queries.length}` +
        `  cov=${cov ? cov.coverage.toFixed(3) : 'n/a'}` +
        `  div=${r.report.data.diversity.avgDistance.toFixed(3)}` +
        `  viol=${v}` +
        `  badTime=${r.report.data.badTimeRefCount}`
      );
    })
    .join('\n');

  const sections = [
    `totals\n` +
      `  configs:           ${n}\n` +
      `  total queries:     ${totalQueries}\n` +
      `  avg queries/config: ${avgPerConfig.toFixed(1)}`,
    `quality (averages)\n` +
      (avgCoverage === null
        ? `  golden coverage:   (no golden fixtures)\n`
        : `  golden coverage:   ${avgCoverage.toFixed(3)}  (${withGolden.length}/${n} have golden)\n`) +
      `  diversity avg:     ${avgDiversity.toFixed(3)}\n` +
      `  diversity min:     ${minDiversity.toFixed(3)}\n` +
      `  language coverage: ${avgLangCoverage.toFixed(3)}`,
    `violations (totals across all configs)\n` +
      `  constraint:        ${totalViolations}\n` +
      `  bad time refs:     ${totalBadTime}\n` +
      `  month-year anchored: ${totalMonthYear}/${totalQueries}`,
    `per-config\n${perConfig}`,
  ];

  return compose(sections);
}

/** @param {number[]} a */
function sum(a) {
  return a.reduce((x, y) => x + y, 0);
}

/** @param {number[]} a */
function avg(a) {
  return a.length === 0 ? 0 : sum(a) / a.length;
}

/**
 * @param {string} title
 * @param {string[]} queries
 */
function queryList(title, queries) {
  if (queries.length === 0) return `${title}: none`;
  return `${title}:\n` + queries.map((q) => `  - ${q}`).join('\n');
}
