/**
 * Deterministic, zero-LLM query expansion. Four diverse phrasings of (city, queryText).
 */

/**
 * @returns {import('../../core/types.js').QueryExpansionStrategy}
 */
export function templates() {
  return function templatesStrategy(_ctx, query) {
    const { city, queryText } = query;
    return {
      queries: [
        `${queryText} events in ${city}`,
        `upcoming ${queryText} ${city}`,
        `${queryText} schedule ${city}`,
        `${queryText} ${city} this month`,
      ],
    };
  };
}
