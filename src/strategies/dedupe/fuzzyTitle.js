/**
 * Same-day fuzzy-title dedupe.
 * Two events on the same day at the same city with similar titles are treated as duplicates.
 */

import { normalize } from '../../core/identity.js';

/**
 * @param {number} threshold
 * @returns {import('../../core/types.js').Strategy}
 */
export function fuzzyTitle(threshold) {
  return function fuzzyTitleStrategy(events) {
    /** @type {import('../../core/types.js').Event[]} */
    const kept = [];
    for (const e of events) {
      const dup = kept.find((k) => isSameDay(k, e) && sameCity(k, e) && titleSim(k.title, e.title) >= threshold);
      if (!dup) kept.push(e);
    }
    return kept;
  };
}

/**
 * @param {import('../../core/types.js').Event} a
 * @param {import('../../core/types.js').Event} b
 */
function isSameDay(a, b) {
  return a.startsAt.slice(0, 10) === b.startsAt.slice(0, 10);
}

/**
 * @param {import('../../core/types.js').Event} a
 * @param {import('../../core/types.js').Event} b
 */
function sameCity(a, b) {
  return normalize(a.venue.city) === normalize(b.venue.city);
}

/**
 * Hybrid similarity: max of token-Jaccard and char-trigram-Jaccard.
 * Tokens handle word-order and length differences; trigrams catch typos
 * and short titles where token overlap is sparse.
 * @param {string} a
 * @param {string} b
 */
function titleSim(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  return Math.max(jaccard(tokens(na), tokens(nb)), jaccard(trigrams(na), trigrams(nb)));
}

/** @param {string} s */
function tokens(s) {
  return new Set(s.split(' ').filter(Boolean));
}

/** @param {string} s */
function trigrams(s) {
  const out = new Set();
  if (s.length < 3) {
    if (s) out.add(s);
    return out;
  }
  for (let i = 0; i <= s.length - 3; i++) out.add(s.slice(i, i + 3));
  return out;
}

/**
 * @param {Set<string>} sa
 * @param {Set<string>} sb
 */
function jaccard(sa, sb) {
  if (sa.size === 0 && sb.size === 0) return 1;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}
