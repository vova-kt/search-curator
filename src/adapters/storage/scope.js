/**
 * Preference scope key encoding. See docs/preferences.md.
 */

/**
 * @param {import('../../core/types.js').PreferenceScope} [scope]
 * @returns {string}
 */
export function scopeKey(scope) {
  if (!scope || (!scope.city && !scope.queryText)) return 'global';
  const parts = [];
  if (scope.city) parts.push(`city:${scope.city.toLowerCase()}`);
  if (scope.queryText) parts.push(`query:${scope.queryText.toLowerCase()}`);
  return parts.join('|');
}

/**
 * Return the scope keys to query when looking up the effective preference for a query:
 * global, then any scoped rows that match. Most-specific scopes come last so they override.
 *
 * @param {import('../../core/types.js').PreferenceScope} [scope]
 * @returns {string[]}
 */
export function effectiveScopeKeys(scope) {
  /** @type {string[]} */
  const keys = ['global'];
  if (scope?.city) keys.push(`city:${scope.city.toLowerCase()}`);
  if (scope?.queryText) keys.push(`query:${scope.queryText.toLowerCase()}`);
  if (scope?.city && scope?.queryText) {
    keys.push(`city:${scope.city.toLowerCase()}|query:${scope.queryText.toLowerCase()}`);
  }
  return keys;
}

/** @returns {import('../../core/types.js').Preference} */
export function emptyPreference() {
  return {
    liked: [],
    disliked: [],
    explicitFilters: {},
  };
}

/**
 * Merge multiple Preference rows. Later wins for primitives; arrays concat with id-dedupe.
 * @param {import('../../core/types.js').Preference[]} prefs
 * @returns {import('../../core/types.js').Preference}
 */
export function mergePreferences(prefs) {
  /** @type {import('../../core/types.js').Preference} */
  const out = emptyPreference();
  /** @type {Set<string>} */
  const likedIds = new Set();
  /** @type {Set<string>} */
  const dislikedIds = new Set();

  for (const p of prefs) {
    for (const e of p.liked) {
      if (!likedIds.has(e.id)) {
        likedIds.add(e.id);
        out.liked.push(e);
      }
    }
    for (const e of p.disliked) {
      if (!dislikedIds.has(e.id)) {
        dislikedIds.add(e.id);
        out.disliked.push(e);
      }
    }
    out.explicitFilters = { ...out.explicitFilters, ...p.explicitFilters };
    if (p.derivedTraits) out.derivedTraits = p.derivedTraits;
    if (p.updatedAt && (!out.updatedAt || p.updatedAt > out.updatedAt)) out.updatedAt = p.updatedAt;
  }
  return out;
}
