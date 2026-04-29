import { buildSystem } from './_system.js';

/**
 * @typedef {Object} DerivePreferenceTraitsArgs
 * @property {Array<{ title: string, venue: { name: string, city: string }, startsAt: string }>} liked
 * @property {Array<{ title: string, venue: { name: string, city: string }, startsAt: string, reason?: string }>} disliked
 *   `reason` is the user's optional free-text note explaining the dislike.
 */

/**
 * Summarize liked / disliked examples into a one-line trait string used as
 * cheaper few-shot context for filter / rank prompts.
 *
 * Structure follows docs/prompts_guide.md.
 *
 * @param {DerivePreferenceTraitsArgs} args
 * @returns {{ system: string, user: string }}
 */
export function derivePreferenceTraitsPrompt({ liked, disliked }) {
  const system = buildSystem({
    role: 'You summarize a user\'s event preferences from examples.',
    task: 'Read the liked and disliked example events and produce one short, dense line that captures the user\'s taste. The line will be reused as cheap context in downstream filter/rank prompts.',
    rules: [
      '- Mention venue style, sub-genres, time-of-day, price band, and any clear avoidances when the examples support them.',
      '- When a disliked example carries a `reason`, weight that user-supplied principle — it is more reliable than inference from the example alone.',
      '- Skip dimensions the examples do not justify rather than guessing.',
      '- One line, comma-separated phrases, no leading article ("Prefers...", "User likes..."). Just the traits.',
      '- Stay under 200 characters.',
    ].join('\n'),
    inputFormat: [
      'The user message contains two XML blocks, each holding a JSON array of example events:',
      '  <liked>[ ... ]</liked>',
      '  <disliked>[ ... ]</disliked>',
      'Either array may be empty.',
    ].join('\n'),
    outputFormat: [
      'Strict JSON of shape:',
      '{ "traits": string }',
      'Where `traits` is one line, <= 200 chars.',
    ].join('\n'),
  });

  const user = [
    '<liked>',
    JSON.stringify(liked, null, 2),
    '</liked>',
    '<disliked>',
    JSON.stringify(disliked, null, 2),
    '</disliked>',
  ].join('\n');

  return { system, user };
}
