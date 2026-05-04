import { llmExpand } from '../../../src/strategies/queryExpansion/index.js';
import { loadExpandGoldenFixture } from '../../core/fixtures.js';
import { writeRun } from '../../core/runs.js';
import { RunKind } from '../../core/runKind.js';
import { buildReport } from './report.js';
import { createEvalContext } from '../../core/ctx.js';

/**
 * @param {import("./types.js").ExpandConfig} cfg
 * @param {{
 *   apiKey: string,
 *   model: string,
 *   temperature: number,
 *   limit: number,
 *   promptSha: string,
 *   writeRunRecord: boolean,
 * }} opts
 * @returns {Promise<import("./types.js").RunResult>}
 */
export async function runOne(
  cfg,
  { apiKey, model, temperature, limit, promptSha, writeRunRecord },
) {
  const slug = `${model}-${cfg.query.queryText}-${cfg.query.city}`;
  const golden = loadExpandGoldenFixture(slug);

  const start = Date.now();
  const ctx = createEvalContext({
    apiKey: apiKey,
    qeModel: model,
    qeMaxQueries: limit,
  });
  const { queries, usage } = await llmExpand()(ctx, cfg.query);
  const elapsedMs = Date.now() - start;

  const report = buildReport({
    candidate: queries,
    golden: golden?.queries ?? null,
    expectedLanguages: cfg.expectedLanguages,
  });

  let runPath = null;
  if (writeRunRecord) {
    runPath = writeRun({
      slug,
      kind: RunKind.EXPAND,
      llm: { provider: 'openai', model, temperature },
      promptHashes: { 'expandQueries.js': promptSha },
      output: queries,
      report: report.data,
    });
  }

  return {
    config: cfg,
    slug,
    queries,
    usage: usage ?? { inputTokens: 0, outputTokens: 0 },
    golden,
    elapsedMs,
    report,
    runPath,
  };
}
