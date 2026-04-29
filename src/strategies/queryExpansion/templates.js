/**
 * Deterministic, zero-LLM query expansion. Four diverse phrasings of (city, queryText).
 */

/**
 * @returns {import('../../core/types.js').QueryExpansionStrategy}
 */
export function templates() {
  return function templatesStrategy(ctx) {
    const { city, queryText } = ctx.query;
    return [
      `${queryText} events in ${city}`,
      `upcoming ${queryText} ${city}`,
      `${queryText} schedule ${city}`,
      `${queryText} ${city} this month`,
    ];
  };
}
