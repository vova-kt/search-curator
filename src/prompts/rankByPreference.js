import { buildSystem } from './_system.js';

/**
 * @typedef {Object} RankByPreferenceArgs
 * @property {Array<{ id: string, title: string, venue: { name: string, city: string }, startsAt: string, subcategories?: string[] }>} candidates
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
 * Structure follows docs/prompts_guide.md.
 *
 * @param {RankByPreferenceArgs} args
 * @returns {{ system: string, user: string }}
 */
export function rankByPreferencePrompt({ candidates, liked, disliked, derivedTraits, guidance }) {
  const system = buildSystem({
    role: 'You filter and rank events for a single user in one pass.',
    task: [
        'Drop candidate events that clearly do not fit the user\'s preferences or stated guidance — omission is how you filter. ' +
        'For each kept event, attach a rationale of about five words explaining the choice.' +
        ' Order kept events by likely interest, highest first.'
    ].join('\n'),
    rules: [
      '- Omit events that contradict <guidance> or that the <liked>/<disliked>/<traits> signals say the user will dislike.',
      '- The <guidance> covers BOTH filtering (omit) and ranking (order). Filter first, then rank what remains.',
      '- Keep events that match the user\'s clear interests, even when imperfect.',
      '- When uncertain, prefer to keep the event but rank it lower.',
      '- Each rationale is around five words and references the specific match (artist, sub-genre, venue type, time of day) — not generic praise.',
      '- Preserve candidate ids verbatim.',
      '- Stable ordering: when two events tie on interest, prefer earlier startsAt.',
    ].join('\n'),
    inputFormat: [
      'The user message contains, in order, any of these XML blocks (some may be omitted when empty):',
      '  <guidance>free-form filter-and-rank instructions from the user (e.g. "no metal, prefer small venues, weeknights ok")</guidance>',
      '  <traits>one-line summary of the user\'s long-term preferences</traits>',
      '  <liked>JSON array of liked example events</liked>',
      '  <disliked>JSON array of disliked example events</disliked>',
      '  <candidates>JSON array of events to filter and rank</candidates>',
    ].join('\n'),
    outputFormat: [
      'Strict JSON of shape:',
      '{ "ranked": [ { "id": string, "rationale": string }, ... ] }',
      'Include only events the user is likely to enjoy. Omit poor matches. Each rationale is ~5 words.',
    ].join('\n'),
  });

  const user = [
    guidance ? `<guidance>${guidance}</guidance>` : null,
    derivedTraits ? `<traits>${derivedTraits}</traits>` : null,
    '<liked>',
    JSON.stringify(liked, null, 2),
    '</liked>',
    '<disliked>',
    JSON.stringify(disliked, null, 2),
    '</disliked>',
    '<candidates>',
    JSON.stringify(candidates, null, 2),
    '</candidates>',
  ]
    .filter((l) => l !== null)
    .join('\n');

  return { system, user };
}
