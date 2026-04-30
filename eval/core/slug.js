/**
 * Filesystem-safe slug for an eval fixture.
 *
 * The slug is the join key between `<slug>.search.json`, `<slug>.golden.json`,
 * and `eval/runs/<slug>__<ts>.json`. It encodes (queryText, city, days, fromDate)
 * so old fixtures stay interpretable from the filename alone.
 */

/**
 * @param {{ queryText: string, city: string, days: number, from: string }} parts
 * @returns {string}
 */
export function makeSlug({ queryText, city, days, from }) {
  return `${slugify(queryText)}__${slugify(city)}__${days}d-from-${from}`;
}

/**
 * @param {string} s
 */
function slugify(s) {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
