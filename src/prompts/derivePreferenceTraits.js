import { buildSystem } from './_system.js';

/**
 * @typedef {Object} DerivePreferenceTraitsArgs
 * @property {string} queryText        // the user's initial freeform query, anchors the trait line's domain
 * @property {string} [guidance]       // user's free-text taste guidance, when set
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
export function derivePreferenceTraitsPrompt({ queryText, guidance, liked, disliked }) {
  const system = buildSystem({
    role: 'You summarize a user\'s event preferences from examples.',
    task: 'Read the liked and disliked example events and produce one short, dense line that captures the user\'s taste. The line will be reused as cheap context in downstream filter/rank prompts.',
    rules: [
      '- Mention sub-genres, time-of-day, price band, and any clear avoidances when the examples support them.',
      '- Stay within the domain of the user\'s initial query — do not generalize beyond it.',
      '- Treat `<guidance>` as an explicit user-stated principle; it outweighs inferences drawn from examples.',
      '- When a disliked example carries a `reason`, weight that user-supplied principle — it is more reliable than inference from the example alone.',
      '- Skip dimensions the examples do not justify rather than guessing.',
      '- One line, comma-separated phrases, no leading article ("Prefers...", "User likes..."). Just the traits.',
      '- Stay under 200 characters.',
    ].join('\n'),
    inputFormat: [
      'The user message contains four XML blocks:',
      '  <query>...</query>           the user\'s initial freeform query',
      '  <guidance>...</guidance>     optional free-text taste guidance; may be absent',
      '  <liked>[ ... ]</liked>       JSON array of liked example events',
      '  <disliked>[ ... ]</disliked> JSON array of disliked example events',
      'Either example array may be empty.',
    ].join('\n'),
    outputFormat: [
      'Strict JSON of shape:',
      '{ "traits": string }',
      'Where `traits` is one line, <= 200 chars.',
    ].join('\n'),
  });

  const parts = [
    '<query>',
    queryText,
    '</query>',
  ];
  if (guidance) {
    parts.push('<guidance>', guidance, '</guidance>');
  }
  parts.push(
    '<liked>',
    JSON.stringify(liked, null, 2),
    '</liked>',
    '<disliked>',
    JSON.stringify(disliked, null, 2),
    '</disliked>',
  );
  const user = parts.join('\n');

  return { system, user };
}
