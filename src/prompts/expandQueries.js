/**
 * @typedef {Object} ExpandQueriesArgs
 * @property {string} city
 * @property {string} category
 * @property {{ from: string, to: string }} timeframe
 * @property {number} limit
 */

/**
 * Build the query-expansion prompt. The LLM returns a JSON object with `queries: string[]`.
 *
 * @param {ExpandQueriesArgs} args
 * @returns {{ system: string, user: string }}
 */
export function expandQueriesPrompt({ city, category, timeframe, limit }) {
  const system =
    'You produce diverse web-search queries that maximize recall for upcoming-event discovery. ' +
    'Return strict JSON. No commentary, no duplicates.';

  const user = [
    `City: ${city}`,
    `Category: ${category}`,
    `Timeframe: ${timeframe.from} to ${timeframe.to}`,
    `Limit: ${limit}`,
    '',
    'Produce up to `Limit` web-search queries a knowledgeable local would type to find these events.',
    'Diversify across these axes:',
    '- Synonyms / register: e.g. "concerts" / "gigs" / "shows"; "talks" / "lectures" / "meetups".',
    '- Local language: when the city\'s primary language is not English, include native-language variants',
    '  (e.g. for Berlin: "Konzerte Berlin"; for Paris: "concerts à Paris"). Keep some English variants too.',
    '- Timeframe phrasings derived from the dates: include calendar-anchored forms like the months/weeks',
    '  spanned (e.g. "May 2026"), and natural-language forms when they fit the window ("this weekend",',
    '  "next month"). Anchor relative phrasings against the `from` date.',
    '- Mix general listings ("events in X") with category-specific ones.',
    '',
    'Constraints:',
    '- Each query must be a plain search string, no boolean operators, no quotes, no site: filters.',
    '- Keep each query under ~80 characters.',
    '- Do not invent venues or artist names.',
    '',
    'Return JSON of shape:',
    '{ "queries": [string, ...] }',
  ].join('\n');

  return { system, user };
}
