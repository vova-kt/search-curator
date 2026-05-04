/**
 * Generic event-set comparison metrics. Reusable across extract and rank evals.
 *
 * `matchEvents` pairs golden ↔ candidate by deduplicationKey: first an exact
 * match pass, then a Jaccard-similarity fallback for keys that are close but
 * not identical. Each candidate is matched at most once. The result is a
 * structural diff that downstream helpers (`precisionRecall`, `fieldAccuracy`)
 * compute scalar metrics from.
 *
 * Hallucination signal is computed separately because it requires the source
 * pages, which `matchEvents` doesn't take.
 */

import { titleSimilarity, titleMatches, dedupKeySimilarity, dedupKeyMatches, dateMatches, venueMatches } from './matching.js';
import { detectExpectedLanguage } from './queryHeuristics.js';

/**
 * @typedef {Object} GenericEvent
 * @property {string} title
 * @property {string} [deduplicationKey]
 * @property {string} startsAt
 * @property {import("../../src/core/types.js").EventScore} score
 * @property {{ name: string, city?: string }} venue
 * @property {{ free?: boolean }} [price]
 */

/**
 * @typedef {Object} MatchPair
 * @property {number} goldenIdx
 * @property {number} candidateIdx
 * @property {number} score                          // title Jaccard
 * @property {{ dedupKey: boolean, title: boolean, date: boolean, venue: boolean }} fields
 */

/**
 * @typedef {Object} MatchResult
 * @property {MatchPair[]} matched
 * @property {number[]} unmatchedGolden
 * @property {number[]} unmatchedCandidate
 */

/**
 * @param {GenericEvent[]} golden
 * @param {GenericEvent[]} candidate
 * @returns {MatchResult}
 */
export function matchEvents(golden, candidate) {
  /** @type {MatchPair[]} */
  const matched = [];
  const usedC = new Set();
  const matchedG = new Set();

  // Pass 0: exact deduplicationKey match (highest confidence).
  for (let gi = 0; gi < golden.length; gi++) {
    const gKey = golden[gi].deduplicationKey;
    if (!gKey) continue;
    for (let ci = 0; ci < candidate.length; ci++) {
      if (usedC.has(ci)) continue;
      const cKey = candidate[ci].deduplicationKey;
      if (!cKey || gKey !== cKey) continue;
      const g = golden[gi];
      const c = candidate[ci];
      usedC.add(ci);
      matchedG.add(gi);
      matched.push({
        goldenIdx: gi,
        candidateIdx: ci,
        score: titleSimilarity(g.title, c.title),
        fields: {
          dedupKey: true,
          title: titleMatches(g.title, c.title),
          date: dateMatches(g.startsAt, c.startsAt),
          venue: venueMatches(g.venue?.name, c.venue?.name),
        },
      });
      break;
    }
  }

  // Pass 1: fuzzy deduplicationKey match (Jaccard above threshold).
  for (let gi = 0; gi < golden.length; gi++) {
    if (matchedG.has(gi)) continue;
    const gKey = golden[gi].deduplicationKey;
    if (!gKey) continue;
    let bestCi = -1;
    let bestScore = 0;
    for (let ci = 0; ci < candidate.length; ci++) {
      if (usedC.has(ci)) continue;
      const cKey = candidate[ci].deduplicationKey;
      if (!cKey || !dedupKeyMatches(gKey, cKey)) continue;
      const score = dedupKeySimilarity(gKey, cKey);
      if (score > bestScore) {
        bestCi = ci;
        bestScore = score;
      }
    }
    if (bestCi !== -1) {
      const g = golden[gi];
      const c = candidate[bestCi];
      usedC.add(bestCi);
      matchedG.add(gi);
      matched.push({
        goldenIdx: gi,
        candidateIdx: bestCi,
        score: titleSimilarity(g.title, c.title),
        fields: {
          dedupKey: false,
          title: titleMatches(g.title, c.title),
          date: dateMatches(g.startsAt, c.startsAt),
          venue: venueMatches(g.venue?.name, c.venue?.name),
        },
      });
    }
  }

  return {
    matched,
    unmatchedGolden: golden.map((_, i) => i).filter((i) => !matchedG.has(i)),
    unmatchedCandidate: candidate.map((_, i) => i).filter((i) => !usedC.has(i)),
  };
}

/**
 * @param {MatchResult} r
 * @param {number} goldenCount
 * @param {number} candidateCount
 */
export function precisionRecall(r, goldenCount, candidateCount) {
  const tp = r.matched.length;
  const recall = goldenCount === 0 ? 0 : tp / goldenCount;
  const precision = candidateCount === 0 ? 0 : tp / candidateCount;
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1, tp, goldenCount, candidateCount };
}

/**
 * Field accuracy on matched pairs only — answers "given we matched the
 * event, did we get the date / venue right?". Doesn't penalize the extractor
 * for missed events; that's recall's job.
 *
 * @param {MatchResult} r
 */
export function fieldAccuracy(r) {
  const n = r.matched.length;
  if (n === 0) return { n: 0, date: 0, venue: 0 };
  let date = 0;
  let venue = 0;
  for (const m of r.matched) {
    if (m.fields.date) date++;
    if (m.fields.venue) venue++;
  }
  return { n, date: date / n, venue: venue / n };
}

/**
 * Token-Jaccard similarity between two strings, lowercased and split on
 * non-alphanumeric runs. Tokens shorter than 2 chars are dropped so common
 * filler ("a", "in") doesn't dominate. Used by query-expansion metrics
 * (golden coverage, diversity) — kept here so all eval kinds share one
 * tokenizer.
 *
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function queryJaccard(a, b) {
  const A = tokenSet(a);
  const B = tokenSet(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** @param {string} s */
function tokenSet(s) {
  return new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9\u00c0-\u024f\u0400-\u04ff]+/i)
      .filter((t) => t.length >= 2),
  );
}

/**
 * Coverage of a hand-curated set of "must-have" query phrasings: for each
 * golden query, the best candidate match by token Jaccard above `threshold`
 * counts as covered. Symmetric to `matchEvents` for the expansion eval.
 *
 * @param {string[]} golden
 * @param {string[]} candidate
 * @param {number} [threshold]
 * @returns {{ matched: Array<{ goldenIdx: number, candidateIdx: number, score: number }>,
 *             unmatchedGolden: number[],
 *             goldenCount: number,
 *             coverage: number }}
 */
export function goldenQueryCoverage(golden, candidate, threshold = 0.5) {
  /** @type {Array<{ goldenIdx: number, candidateIdx: number, score: number }>} */
  const matched = [];
  const usedC = new Set();
  for (let gi = 0; gi < golden.length; gi++) {
    let bestCi = -1;
    let bestScore = threshold;
    for (let ci = 0; ci < candidate.length; ci++) {
      if (usedC.has(ci)) continue;
      const s = queryJaccard(golden[gi], candidate[ci]);
      if (s >= bestScore) {
        bestCi = ci;
        bestScore = s;
      }
    }
    if (bestCi !== -1) {
      usedC.add(bestCi);
      matched.push({ goldenIdx: gi, candidateIdx: bestCi, score: bestScore });
    }
  }
  const matchedG = new Set(matched.map((m) => m.goldenIdx));
  return {
    matched,
    unmatchedGolden: golden.map((_, i) => i).filter((i) => !matchedG.has(i)),
    goldenCount: golden.length,
    coverage: golden.length === 0 ? 0 : matched.length / golden.length,
  };
}

/**
 * Average pairwise token-Jaccard distance (1 - similarity). Higher means the
 * expansion returned a more varied set; very low values flag near-duplicates
 * the LLM didn't deduplicate itself.
 *
 * @param {string[]} queries
 * @returns {{ pairs: number, avgDistance: number, minDistance: number }}
 */
export function queryDiversity(queries) {
  if (queries.length < 2) return { pairs: 0, avgDistance: 0, minDistance: 0 };
  let sum = 0;
  let pairs = 0;
  let min = 1;
  for (let i = 0; i < queries.length; i++) {
    for (let j = i + 1; j < queries.length; j++) {
      const d = 1 - queryJaccard(queries[i], queries[j]);
      sum += d;
      pairs++;
      if (d < min) min = d;
    }
  }
  return { pairs, avgDistance: sum / pairs, minDistance: min };
}

/**
 * Hard violations of the expandQueries prompt rules. Each violation is a
 * concrete prompt-contract failure (>80 chars, boolean operators, quoted
 * phrases, `site:` filter, exact duplicate) — the LLM should produce zero.
 *
 * @param {string[]} queries
 * @returns {{ total: number,
 *             tooLong: number[],
 *             booleanOps: number[],
 *             quoted: number[],
 *             siteFilter: number[],
 *             duplicates: number[] }}
 */
export function constraintCompliance(queries) {
  const tooLong = [];
  const booleanOps = [];
  const quoted = [];
  const siteFilter = [];
  const duplicates = [];
  const seen = new Map();
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    if (q.length > 80) tooLong.push(i);
    if (/\b(AND|OR|NOT)\b/.test(q) || /[+|]/.test(q)) booleanOps.push(i);
    if (/["']/.test(q)) quoted.push(i);
    if (/\bsite:/i.test(q)) siteFilter.push(i);
    const norm = q.trim().toLowerCase();
    if (seen.has(norm)) duplicates.push(i);
    else seen.set(norm, i);
  }
  return {
    total: queries.length,
    tooLong,
    booleanOps,
    quoted,
    siteFilter,
    duplicates,
  };
}

/**
 * Fraction of candidate queries that look like one of the languages the
 * city's audience speaks. Each query is classified via
 * [queryHeuristics.detectExpectedLanguage](./queryHeuristics.js); the result
 * is bucketed into `distribution[lang]` if it's in `expected`, otherwise
 * counted as `unexpected`.
 *
 * @param {string[]} queries
 * @param {string[]} expected  ISO 639-1 codes
 * @returns {{ total: number, matched: number, coverage: number,
 *             distribution: Record<string, number>, unexpected: number }}
 */
export function expectedLanguageCoverage(queries, expected) {
  /** @type {Record<string, number>} */
  const distribution = Object.fromEntries(expected.map((l) => [l, 0]));
  let matched = 0;
  let unexpected = 0;
  for (const q of queries) {
    const lang = detectExpectedLanguage(q, expected);
    if (expected.includes(lang)) {
      distribution[lang]++;
      matched++;
    } else {
      unexpected++;
    }
  }
  return {
    total: queries.length,
    matched,
    coverage: queries.length === 0 ? 0 : matched / queries.length,
    distribution,
    unexpected,
  };
}

/**
 * Score-agreement metrics between two parallel arrays of numbers (one per
 * matched golden↔candidate pair). Returns Spearman rank correlation, Pearson
 * correlation, and mean absolute error. With fewer than 3 pairs, correlation
 * is undefined — returns `null` for those fields.
 *
 * @param {number[]} golden
 * @param {number[]} candidate
 * @returns {{ spearman: number | null, pearson: number | null, mae: number, n: number }}
 */
export function scoreCorrelation(golden, candidate) {
  const n = golden.length;
  if (n === 0) return { spearman: null, pearson: null, mae: 0, n: 0 };

  let maeSum = 0;
  for (let i = 0; i < n; i++) maeSum += Math.abs(golden[i] - candidate[i]);
  const mae = maeSum / n;

  if (n < 3) return { spearman: null, pearson: null, mae, n };

  const pearson = pearsonR(golden, candidate);
  const spearman = pearsonR(toRanks(golden), toRanks(candidate));

  return { spearman, pearson, mae, n };
}

/**
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {number}
 */
function pearsonR(xs, ys) {
  const n = xs.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
    sumXY += xs[i] * ys[i];
    sumX2 += xs[i] * xs[i];
    sumY2 += ys[i] * ys[i];
  }
  const denom = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  return denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
}

/**
 * Assign fractional ranks (average of tied positions) to an array of values.
 * @param {number[]} arr
 * @returns {number[]}
 */
function toRanks(arr) {
  const indexed = arr.map((v, i) => ({ v, i }));
  indexed.sort((a, b) => a.v - b.v);
  const ranks = new Array(arr.length);
  let pos = 0;
  while (pos < indexed.length) {
    let end = pos + 1;
    while (end < indexed.length && indexed[end].v === indexed[pos].v) end++;
    const avgRank = (pos + end - 1) / 2 + 1;
    for (let k = pos; k < end; k++) ranks[indexed[k].i] = avgRank;
    pos = end;
  }
  return ranks;
}

/**
 * Soft signal: candidate events whose title tokens don't appear in any of
 * the source page texts. False positives are common (the LLM may rephrase a
 * title), so this is informational, not part of precision/recall.
 *
 * @param {GenericEvent[]} candidate
 * @param {{ snippet?: string, content?: string }[]} hits
 * @returns {Array<{ idx: number, title: string }>}
 */
export function hallucinationSignal(candidate, hits) {
  const corpus = hits
    .map((h) => `${h.snippet ?? ''} ${h.content ?? ''}`)
    .join(' ')
    .toLowerCase();
  /** @type {Array<{ idx: number, title: string }>} */
  const out = [];
  for (let i = 0; i < candidate.length; i++) {
    const tokens = candidate[i].title
      .toLowerCase()
      .split(/[^\p{Letter}\p{Number}]+/u)
      .filter((t) => t.length >= 4);
    if (tokens.length === 0) continue;
    const present = tokens.filter((t) => corpus.includes(t)).length;
    if (present / tokens.length < 0.4) {
      out.push({ idx: i, title: candidate[i].title });
    }
  }
  return out;
}
