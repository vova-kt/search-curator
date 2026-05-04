import { scoreCorrelation } from '../../core/metrics.js';
import { ratio } from '../../core/report.js';
import { overallScore } from '../../../src/core/scoring.js';
import { DEFAULTS } from '../../../src/index.js';
import { fmtDay, fmtCorr, section } from './helpers.js';

/** @typedef {import('./types.js').SlugResult} SlugResult */
/** @typedef {import('./types.js').Aggregate} Aggregate */
/** @typedef {import('./types.js').CorrResult} CorrResult */

/**
 * @param {string[]} slugs
 * @param {PromiseSettledResult<SlugResult>[]} results
 * @param {{ model: string, temperature: number }} config
 */
export function printReport(slugs, results, config) {
  /** @type {SlugResult[]} */
  const fulfilled = [];
  /** @type {Array<{ slug: string, reason: unknown }>} */
  const failed = [];

  for (let i = 0; i < slugs.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') fulfilled.push(r.value);
    else failed.push({ slug: slugs[i], reason: r.reason });
  }

  const evaluated = fulfilled.filter((sr) => sr.metrics);
  const bootstrapped = fulfilled.filter((sr) => !sr.metrics);

  console.log(
    `extract eval — ${slugs.length} fixtures, model: ${config.model}, temperature: ${config.temperature}`,
  );
  if (failed.length > 0) console.log(`  ${failed.length} failed`);

  printSlugTable(fulfilled, failed, bootstrapped.length > 0);

  if (evaluated.length > 0) {
    const agg = aggregate(evaluated);
    printAggregate(evaluated.length, agg);
    printMissed(evaluated);
    printFalsePositives(evaluated);
  }

  printHallucinations(fulfilled);

  if (evaluated.length > 0) {
    printInsights(evaluated, aggregate(evaluated));
  }

  if (bootstrapped.length > 0) {
    console.log(section('bootstrap — no golden', bootstrapped.length));
    for (const sr of bootstrapped) {
      console.log(`  ${sr.slug}: ${sr.events.length} candidates extracted`);
      if (sr.goldenPath) console.log(`    golden written → ${sr.goldenPath}`);
      if (sr.hallucination.length > 0) {
        for (const h of sr.hallucination) console.log(`    halluc: "${h.title}"`);
      }
    }
  }
}

// ── report sections ────────────────────────────────────────────────────

/**
 * @param {SlugResult[]} fulfilled
 * @param {Array<{ slug: string, reason: unknown }>} failed
 * @param {boolean} hasBootstrap
 */
function printSlugTable(fulfilled, failed, hasBootstrap) {
  console.log(section('per-slug', fulfilled.length + failed.length));
  console.log(
    '  ' +
      'slug'.padEnd(32) +
      'hits'.padStart(5) +
      'gold'.padStart(6) +
      'cand'.padStart(6) +
      'recall'.padStart(8) +
      'prec'.padStart(8) +
      'f1'.padStart(8) +
      'date'.padStart(7) +
      'venue'.padStart(7) +
      'qi_r'.padStart(7) +
      'ov_r'.padStart(7) +
      'hal'.padStart(5) +
      'time'.padStart(7),
  );

  for (const sr of fulfilled) {
    const m = sr.metrics;
    const prefix = m ? '  ' : '* ';
    const label = prefix + sr.slug.slice(0, 30).padEnd(30);
    const time = (sr.elapsedMs / 1000).toFixed(1) + 's';

    if (m) {
      console.log(
        label +
          String(sr.hitCount).padStart(5) +
          String(m.pr.goldenCount).padStart(6) +
          String(m.pr.candidateCount).padStart(6) +
          m.pr.recall.toFixed(3).padStart(8) +
          m.pr.precision.toFixed(3).padStart(8) +
          m.pr.f1.toFixed(3).padStart(8) +
          m.fa.date.toFixed(3).padStart(7) +
          m.fa.venue.toFixed(3).padStart(7) +
          fmtCorr(m.queryIntentCorr.spearman).padStart(7) +
          fmtCorr(m.overallCorr.spearman).padStart(7) +
          String(sr.hallucination.length).padStart(5) +
          time.padStart(7),
      );
    } else {
      console.log(
        label +
          String(sr.hitCount).padStart(5) +
          '—'.padStart(6) +
          String(sr.events.length).padStart(6) +
          '—'.padStart(8) +
          '—'.padStart(8) +
          '—'.padStart(8) +
          '—'.padStart(7) +
          '—'.padStart(7) +
          '—'.padStart(7) +
          '—'.padStart(7) +
          String(sr.hallucination.length).padStart(5) +
          time.padStart(7),
      );
    }
  }

  for (const f of failed) {
    console.log(`  FAIL  ${f.slug.slice(0, 30).padEnd(30)} — ${f.reason}`);
  }

  if (hasBootstrap) console.log('  (* = bootstrap, no golden file)');
}

/**
 * @param {SlugResult[]} evaluated
 * @returns {Aggregate}
 */
export function aggregate(evaluated) {
  let tp = 0,
    goldenCount = 0,
    candidateCount = 0;
  let dateOk = 0,
    venueOk = 0,
    matchedN = 0;
  let hallucCount = 0;

  const weights = DEFAULTS.scoring.weights;
  /** @type {number[]} */
  const pooledGoldenOverall = [];
  /** @type {number[]} */
  const pooledCandOverall = [];
  /** @type {number[]} */
  const pooledGoldenQI = [];
  /** @type {number[]} */
  const pooledCandQI = [];

  for (const sr of evaluated) {
    const m = sr.metrics;
    if (!m) continue;
    tp += m.pr.tp;
    goldenCount += m.pr.goldenCount;
    candidateCount += m.pr.candidateCount;
    dateOk += Math.round(m.fa.date * m.fa.n);
    venueOk += Math.round(m.fa.venue * m.fa.n);
    matchedN += m.fa.n;
    hallucCount += sr.hallucination.length;

    for (const p of m.match.matched) {
      const g = sr.golden?.[p.goldenIdx];
      const c = sr.events[p.candidateIdx];
      pooledGoldenOverall.push(overallScore(g?.score ?? {}, weights));
      pooledCandOverall.push(overallScore(c.score ?? {}, weights));
      pooledGoldenQI.push(g?.score?.queryIntent ?? 0);
      pooledCandQI.push(c.score?.queryIntent ?? 0);
    }
  }

  const recall = goldenCount === 0 ? 0 : tp / goldenCount;
  const precision = candidateCount === 0 ? 0 : tp / candidateCount;
  const f1 =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const dateAcc = matchedN === 0 ? 0 : dateOk / matchedN;
  const venueAcc = matchedN === 0 ? 0 : venueOk / matchedN;

  return {
    tp,
    goldenCount,
    candidateCount,
    recall,
    precision,
    f1,
    dateOk,
    venueOk,
    matchedN,
    dateAcc,
    venueAcc,
    hallucCount,
    overallCorr: scoreCorrelation(pooledGoldenOverall, pooledCandOverall),
    queryIntentCorr: scoreCorrelation(pooledGoldenQI, pooledCandQI),
  };
}

/**
 * @param {number} evalCount
 * @param {Aggregate} a
 */
function printAggregate(evalCount, a) {
  console.log(section(`aggregate — ${evalCount} evaluated`, 0));
  console.log(ratio('recall', a.tp, a.goldenCount));
  console.log(ratio('precision', a.tp, a.candidateCount, `f1=${a.f1.toFixed(3)}`));
  console.log(ratio('date within ±1 day', a.dateOk, a.matchedN));
  console.log(ratio('venue match', a.venueOk, a.matchedN));
  console.log(`  hallucination signal          ${a.hallucCount}`);

  console.log(section('score quality', 0));
  printCorrBlock('overall (weighted)', a.overallCorr);
  printCorrBlock('queryIntent', a.queryIntentCorr);
}

/** @param {string} label @param {CorrResult} c */
function printCorrBlock(label, c) {
  if (c.n === 0) {
    console.log(`  ${label.padEnd(28)} no matched pairs`);
    return;
  }
  console.log(
    `  ${label.padEnd(28)} spearman=${fmtCorr(c.spearman)}  pearson=${fmtCorr(c.pearson)}  mae=${c.mae.toFixed(2)}  n=${c.n}`,
  );
}

/** @param {SlugResult[]} evaluated */
function printMissed(evaluated) {
  /** @type {Array<{ slug: string, title: string, date: string, venue: string }>} */
  const missed = [];
  for (const sr of evaluated) {
    if (!sr.metrics || !sr.golden) continue;
    for (const gi of sr.metrics.match.unmatchedGolden) {
      const e = sr.golden[gi];
      missed.push({
        slug: sr.slug,
        title: e.title,
        date: fmtDay(e.startsAt),
        venue: e.venue?.name ?? '?',
      });
    }
  }
  if (missed.length === 0) return;
  console.log(section('missed golden events', missed.length));
  for (const m of missed) {
    console.log(`  [${m.slug}] "${m.title}" ${m.date} — ${m.venue}`);
  }
}

/** @param {SlugResult[]} evaluated */
function printFalsePositives(evaluated) {
  /** @type {Array<{ slug: string, title: string, date: string, venue: string, dedupKey: string }>} */
  const fps = [];
  for (const sr of evaluated) {
    if (!sr.metrics) continue;
    for (const ci of sr.metrics.match.unmatchedCandidate) {
      const e = sr.events[ci];
      fps.push({
        slug: sr.slug,
        title: e.title,
        date: fmtDay(e.startsAt),
        venue: e.venue?.name ?? '?',
        dedupKey: e.deduplicationKey ?? '?',
      });
    }
  }
  if (fps.length === 0) return;
  console.log(section('false positives', fps.length));
  for (const fp of fps) {
    console.log(`  [${fp.slug}] "${fp.title}" ${fp.date} — ${fp.venue}  dedup: ${fp.dedupKey}`);
  }
}

/** @param {SlugResult[]} fulfilled */
function printHallucinations(fulfilled) {
  /** @type {Array<{ slug: string, title: string }>} */
  const all = [];
  for (const sr of fulfilled) {
    for (const h of sr.hallucination) all.push({ slug: sr.slug, title: h.title });
  }
  if (all.length === 0) return;
  console.log(section('hallucination signal', all.length));
  for (const h of all) {
    console.log(`  [${h.slug}] "${h.title}"`);
  }
}

/**
 * @param {SlugResult[]} evaluated
 * @param {Aggregate} a
 */
function printInsights(evaluated, a) {
  /** @type {string[]} */
  const ins = [];

  if (a.recall < a.precision && a.recall < 0.9) {
    const worst = evaluated.reduce((w, sr) =>
      sr.metrics && sr.metrics.pr.recall < (w.metrics?.pr.recall ?? 1) ? sr : w,
    );
    ins.push(
      `recall (${a.recall.toFixed(3)}) < precision (${a.precision.toFixed(3)}) — the prompt misses events ` +
        `more than it invents them. ${a.goldenCount - a.tp} golden events missed.` +
        (worst.metrics
          ? ` Worst: ${worst.slug} (recall ${worst.metrics.pr.recall.toFixed(3)}).`
          : ''),
    );
  } else if (a.precision < a.recall && a.precision < 0.9) {
    const worst = evaluated.reduce((w, sr) =>
      sr.metrics && sr.metrics.pr.precision < (w.metrics?.pr.precision ?? 1) ? sr : w,
    );
    ins.push(
      `precision (${a.precision.toFixed(3)}) < recall (${a.recall.toFixed(3)}) — the prompt over-extracts. ` +
        `${a.candidateCount - a.tp} false positives.` +
        (worst.metrics
          ? ` Worst: ${worst.slug} (precision ${worst.metrics.pr.precision.toFixed(3)}).`
          : ''),
    );
  } else if (a.recall < 0.9 && a.precision < 0.9) {
    ins.push(
      `both recall (${a.recall.toFixed(3)}) and precision (${a.precision.toFixed(3)}) are below 0.9 — ` +
        `the prompt both misses events and invents extras.`,
    );
  }

  if (a.matchedN > 0) {
    if (a.dateAcc < a.venueAcc - 0.05) {
      ins.push(
        `date accuracy (${a.dateAcc.toFixed(3)}) lags venue accuracy (${a.venueAcc.toFixed(3)}) — ` +
          `date extraction or normalization is the weaker link. Check date format instructions in the prompt.`,
      );
    } else if (a.venueAcc < a.dateAcc - 0.05) {
      ins.push(
        `venue accuracy (${a.venueAcc.toFixed(3)}) lags date accuracy (${a.dateAcc.toFixed(3)}) — ` +
          `venue name extraction is the weaker link. The prompt may need clearer venue-matching rules.`,
      );
    }
  }

  if (a.hallucCount > 0) {
    ins.push(
      `${a.hallucCount} event(s) flagged as hallucinations (<40% title-token overlap with source pages) — ` +
        `consider strengthening grounding instructions ("only extract events explicitly named in the provided text").`,
    );
  }

  if (evaluated.length > 1) {
    const sorted = evaluated
      .filter((sr) => sr.metrics)
      .sort((a, b) => (a.metrics?.pr.f1 ?? 0) - (b.metrics?.pr.f1 ?? 0));
    const worst = sorted[0];
    const best = sorted[sorted.length - 1];
    if (worst.metrics && best.metrics && best.metrics.pr.f1 - worst.metrics.pr.f1 > 0.1) {
      ins.push(
        `${worst.slug} underperforms (f1=${worst.metrics.pr.f1.toFixed(3)}) vs ` +
          `${best.slug} (f1=${best.metrics.pr.f1.toFixed(3)}) — review its missed events for patterns ` +
          `the prompt handles poorly (e.g. specific event types, languages, page formats).`,
      );
    }
  }

  if (a.overallCorr.spearman != null && a.overallCorr.spearman < 0.5) {
    ins.push(
      `overall score Spearman correlation is low (${a.overallCorr.spearman.toFixed(3)}) — ` +
        `the LLM's scoring disagrees with golden on relative event ranking. ` +
        `MAE=${a.overallCorr.mae.toFixed(2)}.`,
    );
  }
  if (a.queryIntentCorr.spearman != null && a.queryIntentCorr.spearman < 0.5) {
    ins.push(
      `queryIntent Spearman correlation is low (${a.queryIntentCorr.spearman.toFixed(3)}) — ` +
        `the LLM misjudges query-intent relevance vs golden. MAE=${a.queryIntentCorr.mae.toFixed(2)}.`,
    );
  }

  const scoreOk = a.overallCorr.spearman == null || a.overallCorr.spearman >= 0.7;
  if (
    a.recall >= 0.95 &&
    a.precision >= 0.95 &&
    a.dateAcc >= 0.95 &&
    a.venueAcc >= 0.95 &&
    a.hallucCount === 0 &&
    scoreOk
  ) {
    ins.push(
      'all metrics ≥ 0.95 with no hallucinations and good score correlation — extraction quality is strong.',
    );
  }

  if (ins.length === 0) return;
  console.log(section('insights', 0));
  for (const i of ins) console.log('  → ' + i);
}
