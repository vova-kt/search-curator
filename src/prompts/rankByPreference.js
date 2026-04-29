/**
 * @typedef {Object} RankByPreferenceArgs
 * @property {Array<{ id: string, title: string, category: string, venue: { name: string, city: string }, startsAt: string, subcategories?: string[] }>} candidates
 * @property {Array<{ title: string, venue: { name: string, city: string }, subcategories?: string[] }>} liked
 * @property {Array<{ title: string, venue: { name: string, city: string }, subcategories?: string[] }>} disliked
 * @property {string} [derivedTraits]
 * @property {string} [guidance]
 */

/**
 * Combined filter + rank in one LLM call.
 *
 * The model is instructed to OMIT events that don't fit the user's preferences
 * or guidance — omission is the filter signal — and to return the kept events
 * ordered by likely interest with a brief rationale.
 *
 * @param {RankByPreferenceArgs} args
 * @returns {{ system: string, user: string }}
 */
export function rankByPreferencePrompt({ candidates, liked, disliked, derivedTraits, guidance }) {
  const system =
    'You filter and rank events for a user in a single pass. ' +
    'Drop events that clearly do not fit the user\'s preferences or stated guidance — omit them from the output. ' +
    'Order the kept events by likely interest, highest first. ' +
    'For each kept event, write a rationale of about five words explaining the choice. ' +
    'Return strict JSON.';

  const user = [
    guidance ? `User guidance: ${guidance}` : null,
    derivedTraits ? `User traits: ${derivedTraits}` : null,
    '',
    'Liked examples:',
    JSON.stringify(liked, null, 2),
    '',
    'Disliked examples:',
    JSON.stringify(disliked, null, 2),
    '',
    'Candidates:',
    JSON.stringify(candidates, null, 2),
    '',
    'Return JSON of shape:',
    '{ "ranked": [ { "id": string, "rationale": string }, ... ] }',
    'Include only events the user is likely to enjoy. Omit poor matches.',
    'Each rationale must be ~5 words.',
  ]
    .filter((l) => l !== null)
    .join('\n');

  return { system, user };
}
