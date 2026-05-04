import {
  goldenQueryCoverage,
  queryDiversity,
  constraintCompliance,
  expectedLanguageCoverage,
} from '../../core/metrics.js';
import { hasMonthYearAnchor, hasBadTimeRef } from '../../core/queryHeuristics.js';
import { ratio, compose } from '../../core/report.js';
import { violationCount, sum, avg, queryList } from './helpers.js';

/** @typedef {import('./types.js').RunResult} RunResult */

/**
 * @typedef {{
 *   diversity: ReturnType<typeof queryDiversity>,
 *   constraintCompliance: ReturnType<typeof constraintCompliance>,
 *   languageCoverage: ReturnType<typeof expectedLanguageCoverage>,
 *   monthYearCount: number,
 *   badTimeRefCount: number,
 *   goldenCoverage?: ReturnType<typeof goldenQueryCoverage>,
 * }} ExpandReportData
 */

/**
 * @typedef {{ text: string, data: ExpandReportData }} ExpandReport
 */

/**
 * @param {{ candidate: string[], golden: string[] | null, expectedLanguages: string[] }} args
 * @returns {ExpandReport}
 */
export function buildReport({ candidate, golden, expectedLanguages }) {
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
      ? queryList('unmatched golden (missed phrasings)', cov.unmatchedGolden.map((i) => /** @type {string[]} */ (golden)[i]))
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
 * @param {RunResult[]} results
 */
export function buildAggregateReport(results) {
  const n = results.length;
  const totalQueries = sum(results.map((r) => r.queries.length));
  const avgPerConfig = totalQueries / n;

  const withGolden = results.filter((r) => r.report?.data.goldenCoverage);
  const avgCoverage = withGolden.length === 0
    ? null
    : avg(withGolden.map((r) => r.report?.data.goldenCoverage?.coverage ?? 0));

  const avgDiversity = avg(results.map((r) => r.report?.data.diversity.avgDistance ?? 0));
  const minDiversity = Math.min(...results.map((r) => r.report?.data.diversity.minDistance ?? 1));

  const totalViolations = sum(results.map((r) => r.report ? violationCount(r.report.data.constraintCompliance) : 0));
  const totalBadTime = sum(results.map((r) => r.report?.data.badTimeRefCount ?? 0));
  const totalMonthYear = sum(results.map((r) => r.report?.data.monthYearCount ?? 0));
  const avgLangCoverage = avg(results.map((r) => r.report?.data.languageCoverage.coverage ?? 0));

  const perConfig = results
    .map((r) => {
      const cov = r.report?.data.goldenCoverage;
      const v = r.report ? violationCount(r.report.data.constraintCompliance) : 0;
      return (
        `  - ${r.slug}` +
        `  n=${r.queries.length}` +
        `  cov=${cov ? cov.coverage.toFixed(3) : 'n/a'}` +
        `  div=${(r.report?.data.diversity.avgDistance ?? 0).toFixed(3)}` +
        `  viol=${v}` +
        `  badTime=${r.report?.data.badTimeRefCount ?? 0}`
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
