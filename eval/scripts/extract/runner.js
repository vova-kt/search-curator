import { resolve } from 'node:path';
import { extract } from '../../../src/stages/extract.js';
import { buildExtractCtx } from '../../core/ctx.js';
import {
  loadSearchFixture,
  loadGoldenFixture,
  writeGoldenFixture,
} from '../../core/fixtures.js';
import { writeRun, gitShaOf } from '../../core/runs.js';
import { RunKind } from '../../core/runKind.js';
import {
  matchEvents,
  precisionRecall,
  fieldAccuracy,
  hallucinationSignal,
  scoreCorrelation,
} from '../../core/metrics.js';
import { overallScore } from '../../../src/core/scoring.js';
import { DEFAULTS } from '../../../src/index.js';

/** @typedef {import('./types.js').SlugResult} SlugResult */

/**
 * @param {string} slug
 * @param {string} apiKey
 * @param {{ model: string, temperature: number, reasoningEffort: 'low'|'medium'|'high'|null }} config
 * @returns {Promise<SlugResult>}
 */
export async function runOne(slug, apiKey, config) {
  const fixture = loadSearchFixture(slug);
  const goldenFixture = loadGoldenFixture(slug);

  const ctx = buildExtractCtx({
    query: {
      city: fixture.query.city,
      queryText: fixture.query.queryText,
      timeframe: fixture.timeframe,
    },
    model: config.model,
    apiKey,
    temperature: config.temperature,
    reasoningEffort: config.reasoningEffort,
  });

  const t0 = Date.now();
  const events = await extract(fixture.hits, ctx);
  const elapsedMs = Date.now() - t0;

  const promptPath = resolve(
    new URL('../../../src/prompts/extractEvents.js', import.meta.url).pathname,
  );

  const golden = goldenFixture ? goldenFixture.events : null;
  const weights = DEFAULTS.scoring.weights;
  let metrics = null;
  if (golden) {
    const m = matchEvents(golden, events);
    const pr = precisionRecall(m, golden.length, events.length);
    const fa = fieldAccuracy(m);
    const goldenOverall = m.matched.map((p) =>
      overallScore(golden[p.goldenIdx].score ?? {}, weights),
    );
    const candOverall = m.matched.map((p) =>
      overallScore(events[p.candidateIdx].score ?? {}, weights),
    );
    const goldenQI = m.matched.map((p) => golden[p.goldenIdx].score?.queryIntent ?? 0);
    const candQI = m.matched.map((p) => events[p.candidateIdx].score?.queryIntent ?? 0);

    metrics = {
      pr,
      fa,
      match: m,
      overallCorr: scoreCorrelation(goldenOverall, candOverall),
      queryIntentCorr: scoreCorrelation(goldenQI, candQI),
    };
  }

  const halluc = hallucinationSignal(events, fixture.hits);

  const reportData = metrics
    ? {
        precisionRecall: metrics.pr,
        fieldAccuracy: metrics.fa,
        match: metrics.match,
        scoreQuality: {
          overall: metrics.overallCorr,
          queryIntent: metrics.queryIntentCorr,
        },
        hallucination: halluc,
      }
    : { hallucination: halluc };

  writeRun({
    slug,
    kind: RunKind.EXTRACT,
    llm: { provider: 'openai', model: config.model, temperature: config.temperature },
    promptHashes: { 'extractEvents.js': gitShaOf(promptPath) },
    output: events,
    report: reportData,
  });

  let goldenPath = null;
  if (!goldenFixture) {
    goldenPath = writeGoldenFixture({ slug, events });
  }

  return {
    slug,
    events,
    golden,
    hitCount: fixture.hits.length,
    elapsedMs,
    metrics,
    hallucination: halluc,
    goldenPath,
  };
}
