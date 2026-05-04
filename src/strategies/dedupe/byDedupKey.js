/**
 * Dedupe by deduplicationKey using token-Jaccard similarity.
 * Replaces byId and fuzzyTitle — the LLM-generated key ("artist, venue, dd-mm-yy")
 * is a better dedup signal than the content-derived id or raw title.
 * Falls back to exact id match for events without a deduplicationKey.
 */

/**
 * @param {number} threshold
 * @returns {import('../../core/types.js').Strategy}
 */
export function byDedupKey(threshold) {
  return function byDedupKeyStrategy(events, _ctx, _query) {
    /** @type {import('../../core/types.js').Event[]} */
    const kept = [];
    /** @type {Set<string>} */
    const seenIds = new Set();
    for (const e of events) {
      if (seenIds.has(e.id)) continue;
      const eKey = e.deduplicationKey;
      const isDup = eKey
        ? kept.some((k) => k.deduplicationKey && jaccardTokens(k.deduplicationKey, eKey) >= threshold)
        : false;
      if (!isDup) {
        kept.push(e);
        seenIds.add(e.id);
      }
    }
    return { events: kept };
  };
}

/**
 * Token-Jaccard similarity on normalized, lowercased tokens.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0–1
 */
export function jaccardTokens(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** @param {string} s */
function tokenize(s) {
  return new Set(
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9\u0400-\u04ff]+/)
      .filter((t) => t.length >= 2),
  );
}
