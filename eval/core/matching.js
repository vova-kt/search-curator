/**
 * Field-level matching primitives. Cheap, deterministic, dependency-free.
 *
 * Used by `metrics.js` to pair golden events with candidate events. Kept in
 * its own module so a future ranking eval can reuse the same comparators.
 */

const TITLE_JACCARD_THRESHOLD = 0.5;
const DATE_TOLERANCE_DAYS = 1;

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} Jaccard similarity over normalized tokens, in [0, 1].
 */
export function titleSimilarity(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/**
 * @param {string} a
 * @param {string} b
 */
export function titleMatches(a, b) {
  return titleSimilarity(a, b) >= TITLE_JACCARD_THRESHOLD;
}

/**
 * @param {string | undefined} a  ISO datetime or date
 * @param {string | undefined} b  ISO datetime or date
 * @returns {boolean} true if both parse and differ by ≤ DATE_TOLERANCE_DAYS calendar days.
 */
export function dateMatches(a, b) {
  if (!a || !b) return false;
  const da = parseDay(a);
  const db = parseDay(b);
  if (da === null || db === null) return false;
  const diff = Math.abs(da - db) / 86_400_000;
  return diff <= DATE_TOLERANCE_DAYS;
}

/**
 * @param {string | undefined} a
 * @param {string | undefined} b
 */
export function venueMatches(a, b) {
  if (!a || !b) return false;
  const na = normalizeVenue(a);
  const nb = normalizeVenue(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * @param {string} s
 * @returns {Set<string>}
 */
function tokenize(s) {
  return new Set(
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 2),
  );
}

/**
 * @param {string} s
 */
function normalizeVenue(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(the|a|an)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * @param {string} s
 * @returns {number | null} epoch ms at UTC midnight, or null if unparseable.
 */
function parseDay(s) {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return null;
  return Math.floor(t / 86_400_000) * 86_400_000;
}
