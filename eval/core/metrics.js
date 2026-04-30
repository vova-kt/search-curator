/**
 * Generic event-set comparison metrics. Reusable across extract and rank evals.
 *
 * `matchEvents` pairs golden ↔ candidate by best title Jaccard above the
 * matching.js threshold, breaking ties by date proximity. Each candidate is
 * matched at most once. The result is a structural diff that downstream
 * helpers (`precisionRecall`, `fieldAccuracy`) compute scalar metrics from.
 *
 * Hallucination signal is computed separately because it requires the source
 * pages, which `matchEvents` doesn't take.
 */

import { titleSimilarity, titleMatches, dateMatches, venueMatches } from './matching.js';

/**
 * @typedef {Object} GenericEvent
 * @property {string} title
 * @property {string} startsAt
 * @property {{ name: string, city?: string }} venue
 * @property {{ free?: boolean }} [price]
 */

/**
 * @typedef {Object} MatchPair
 * @property {number} goldenIdx
 * @property {number} candidateIdx
 * @property {number} score                          // title Jaccard
 * @property {{ title: boolean, date: boolean, venue: boolean }} fields
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

  for (let gi = 0; gi < golden.length; gi++) {
    const g = golden[gi];
    let bestCi = -1;
    let bestScore = 0;
    let bestDateOk = false;
    for (let ci = 0; ci < candidate.length; ci++) {
      if (usedC.has(ci)) continue;
      const c = candidate[ci];
      const score = titleSimilarity(g.title, c.title);
      if (!titleMatches(g.title, c.title)) continue;
      const dateOk = dateMatches(g.startsAt, c.startsAt);
      // Prefer higher title score; break ties by date match.
      if (score > bestScore || (score === bestScore && dateOk && !bestDateOk)) {
        bestCi = ci;
        bestScore = score;
        bestDateOk = dateOk;
      }
    }
    if (bestCi !== -1) {
      const c = candidate[bestCi];
      usedC.add(bestCi);
      matched.push({
        goldenIdx: gi,
        candidateIdx: bestCi,
        score: bestScore,
        fields: {
          title: true,
          date: dateMatches(g.startsAt, c.startsAt),
          venue: venueMatches(g.venue?.name, c.venue?.name),
        },
      });
    }
  }

  const matchedG = new Set(matched.map((m) => m.goldenIdx));
  const matchedC = new Set(matched.map((m) => m.candidateIdx));
  return {
    matched,
    unmatchedGolden: golden.map((_, i) => i).filter((i) => !matchedG.has(i)),
    unmatchedCandidate: candidate.map((_, i) => i).filter((i) => !matchedC.has(i)),
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
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4);
    if (tokens.length === 0) continue;
    const present = tokens.filter((t) => corpus.includes(t)).length;
    if (present / tokens.length < 0.4) {
      out.push({ idx: i, title: candidate[i].title });
    }
  }
  return out;
}
