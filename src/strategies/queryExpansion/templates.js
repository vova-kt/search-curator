/**
 * Deterministic, zero-LLM query expansion. Four diverse phrasings of (city, category).
 */

/**
 * @returns {import('../../core/types.js').QueryExpansionStrategy}
 */
export function templates() {
  return function templatesStrategy(ctx) {
    const { city, category } = ctx.query;
    return [
      `${category} events in ${city}`,
      `upcoming ${category} ${city}`,
      `${category} schedule ${city}`,
      `live ${category} ${city} this month`,
    ];
  };
}
