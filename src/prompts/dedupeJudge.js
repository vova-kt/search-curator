import { buildSystem } from './_system.js';

/**
 * @typedef {Object} DedupeJudgeArgs
 * @property {Array<{ id: string, title: string, startsAt: string, venue: { name: string, city: string } }>} candidates
 */

/**
 * Ask the LLM to merge near-duplicate events.
 * Returns groups of ids that refer to the same real-world event.
 *
 * Structure follows docs/prompts.md.
 *
 * @param {DedupeJudgeArgs} args
 * @returns {{ system: string, user: string }}
 */
export function dedupeJudgePrompt({ candidates }) {
  const system = buildSystem({
    role: 'You decide whether events are duplicates of one another (the same real-world event listed twice).',
    task: 'Cluster the supplied candidate events into groups, where each group lists the ids that refer to the same event. Return the groups as JSON.',
    rules: [
      '- Same artist or speaker on different nights is NOT a duplicate.',
      '- Same title at different venues or in different cities is NOT a duplicate.',
      '- Minor title variations (translations, capitalization, presence of an opener) at the same venue and start time ARE a duplicate.',
      '- Every input id must appear in exactly one output group. Singletons are allowed and expected.',
      '- Preserve ids verbatim.',
    ].join('\n'),
    inputFormat: 'The user message contains a single <candidates> block with a JSON array of candidate events. Each candidate has: { id, title, startsAt, venue: { name, city } }.',
    outputFormat: [
      'Strict JSON of shape:',
      '{ "groups": [ [id1, id2, ...], [id3], ... ] }',
    ].join('\n'),
  });

  const user = [
    '<candidates>',
    JSON.stringify(candidates, null, 2),
    '</candidates>',
  ].join('\n');

  return { system, user };
}
