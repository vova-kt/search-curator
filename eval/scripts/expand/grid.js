import { violationCount } from './helpers.js';

/** @typedef {import('./types.js').VariationResult} VariationResult */

/**
 * @param {VariationResult[]} all
 * @param {number} configCount
 */
export function renderGridReport(all, configCount) {
  const hdr =
    'model             temp  limit  queries  diversity  langCov  violations  badTime  inTok     outTok    cost$     time';
  const sep = '-'.repeat(hdr.length);
  const rows = all.map((v) => {
    const ok = v.results.filter((r) => !r.error);
    const avgQueries = ok.length === 0 ? 0 : ok.reduce((s, r) => s + r.queries.length, 0) / ok.length;
    const avgDiv = ok.length === 0 ? 0 : ok.reduce((s, r) => s + (r.report?.data.diversity.avgDistance ?? 0), 0) / ok.length;
    const avgLang = ok.length === 0 ? 0 : ok.reduce((s, r) => s + (r.report?.data.languageCoverage.coverage ?? 0), 0) / ok.length;
    const totalViol = ok.reduce((s, r) => s + (r.report ? violationCount(r.report.data.constraintCompliance) : 0), 0);
    const totalBad = ok.reduce((s, r) => s + (r.report?.data.badTimeRefCount ?? 0), 0);
    const errors = v.results.filter((r) => r.error).length;
    const errSuffix = errors > 0 ? `  (${errors} err)` : '';
    const costStr = v.cost ? v.cost.totalCost.toFixed(4) : 'n/a';

    return [
      v.variation.model.padEnd(18),
      v.variation.temperature.toFixed(1).padStart(4),
      String(v.variation.limit).padStart(6),
      avgQueries.toFixed(1).padStart(8),
      avgDiv.toFixed(3).padStart(10),
      avgLang.toFixed(3).padStart(8),
      String(totalViol).padStart(11),
      String(totalBad).padStart(8),
      String(v.cost.inputTokens).padStart(9),
      String(v.cost.outputTokens).padStart(9),
      costStr.padStart(9),
      (v.elapsedMs / 1000).toFixed(1).padStart(7) + 's' + errSuffix,
    ].join('');
  });

  const totalCost = all.reduce((s, v) => s + (v.cost?.totalCost ?? 0), 0);
  const totalTime = all.reduce((s, v) => s + v.elapsedMs, 0);
  const totalIn = all.reduce((s, v) => s + v.cost.inputTokens, 0);
  const totalOut = all.reduce((s, v) => s + v.cost.outputTokens, 0);

  return [
    `expand grid eval — ${all.length} variations × ${configCount} configs\n`,
    sep,
    hdr,
    sep,
    ...rows,
    sep,
    `totals: ${totalIn} input + ${totalOut} output tokens, $${totalCost.toFixed(4)}, ${(totalTime / 1000).toFixed(1)}s`,
    '',
    renderInsights(all),
  ].join('\n');
}

/**
 * @param {VariationResult[]} all
 */
function renderInsights(all) {
  const scored = all
    .filter((v) => v.results.every((r) => !r.error))
    .map((v) => {
      const ok = v.results;
      const avgDiv = ok.reduce((s, r) => s + (r.report?.data.diversity.avgDistance ?? 0), 0) / ok.length;
      const avgLang = ok.reduce((s, r) => s + (r.report?.data.languageCoverage.coverage ?? 0), 0) / ok.length;
      const totalViol = ok.reduce((s, r) => s + (r.report ? violationCount(r.report.data.constraintCompliance) : 0), 0);
      const totalBad = ok.reduce((s, r) => s + (r.report?.data.badTimeRefCount ?? 0), 0);
      const quality = avgDiv * 0.4 + avgLang * 0.4 - totalViol * 0.05 - totalBad * 0.05;
      return { v, avgDiv, avgLang, totalViol, totalBad, quality };
    });

  if (scored.length === 0) return 'no error-free variations to rank';

  scored.sort((a, b) => b.quality - a.quality);
  const best = scored[0];
  const cheapest = scored.reduce((a, b) => (a.v.cost?.totalCost ?? Infinity) < (b.v.cost?.totalCost ?? Infinity) ? a : b);

  const tag = (/** @type {{ v: VariationResult }} */ s) => `${s.v.variation.model} t=${s.v.variation.temperature} l=${s.v.variation.limit}`;

  const lines = [
    'insights',
    `  best quality:  ${tag(best)}  (div=${best.avgDiv.toFixed(3)} lang=${best.avgLang.toFixed(3)} viol=${best.totalViol} bad=${best.totalBad})  $${(best.v.cost?.totalCost ?? 0).toFixed(4)}`,
    `  cheapest:      ${tag(cheapest)}  $${(cheapest.v.cost?.totalCost ?? 0).toFixed(4)}  (div=${cheapest.avgDiv.toFixed(3)} lang=${cheapest.avgLang.toFixed(3)} viol=${cheapest.totalViol})`,
  ];

  if (best !== cheapest && best.v.cost && cheapest.v.cost) {
    const costDelta = best.v.cost.totalCost - cheapest.v.cost.totalCost;
    const qualDelta = best.quality - cheapest.quality;
    lines.push(`  quality premium: +$${costDelta.toFixed(4)} for +${qualDelta.toFixed(3)} quality score`);
  }

  return lines.join('\n');
}
