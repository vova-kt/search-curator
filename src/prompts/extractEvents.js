import { buildSystem } from './_system.js';

/**
 * @typedef {Object} ExtractPage
 * @property {string} sourceName
 * @property {string} sourceUrl
 * @property {string} pageText
 */

/**
 * @typedef {Object} ExtractEventsArgs
 * @property {string} city
 * @property {string} queryText
 * @property {{ from: string, to: string }} timeframe
 * @property {ExtractPage[]} pages
 */

/**
 * Build the extract-events prompt. The LLM receives one or more pages in a
 * single request and returns a JSON object with `events: Event[]`, where each
 * event echoes back the `source.name` and `source.url` of the page it was
 * extracted from.
 *
 * Page text can be large, so this prompt applies the long-input exception
 * documented in docs/prompts.md: the bulk `<pages>` block sits at the
 * top of the user message, with the short query recap at the bottom.
 *
 * @param {ExtractEventsArgs} args
 * @returns {{ system: string, user: string }}
 */
export function extractEventsPrompt({ city, queryText, timeframe, pages }) {
  const system = buildSystem({
    role: 'You extract structured upcoming events from web content.',
    task: [
      'Read the supplied pages and return the events they describe as JSON. ' +
      'A single request may include multiple pages — return events from all of them. ' +
      'If a single page describes multiple events, return all of them.'
    ].join('\n'),
    rules: [
      '- Return only events whose startsAt is within the user\'s Timeframe.',
      '- Return only events in or near the user\'s City.',
      '- Treat the user\'s Query as the topic focus: prefer events that fit it; skip clearly unrelated events.',
      '- Omit any event you cannot date precisely (no "TBD", no "soon").',
      '- Skip past events, generic listings, and content that is not an event.',
      '- Do not invent details. Leave fields out rather than guess.',
      '- For each event, set source.name and source.url to the SOURCE_NAME and SOURCE_URL of the page it was extracted from, copied verbatim. Never substitute another URL mentioned inside the page content. If one page yields multiple events, every event repeats the same source.',
      '- If unsure whether something is an event, omit it.',
    ].join('\n'),
    inputFormat: [
      'The user message contains, in order:',
      '  1. A <pages> block holding one or more <page> entries. Each <page> has:',
      '       <source_name>opaque adapter id; echo verbatim</source_name>',
      '       <source_url>page url; echo verbatim</source_url>',
      '       <content>raw page text</content>',
      '  2. A <query> block with the user\'s preferences:',
      '       <city>...</city>',
      '       <text>user\'s freeform query</text>',
      '       <timeframe from="ISO" to="ISO" />',
    ].join('\n'),
    outputFormat: [
      'Strict JSON of shape:',
      '{ "events": [',
      '  { "title": string,',
      '    "description": string?,',
      '    "startsAt": ISO 8601 datetime string,',
      '    "endsAt": ISO 8601 datetime string?,',
      '    "venue": { "name": string, "address": string?, "city": string, "country": string? },',
      '    "source": { "name": string, "url": string },',
      '    "price": { "currency": string?, "min": number?, "max": number?, "free": boolean? }?',
      '  }',
      '] }',
    ].join('\n'),
  });

  const pagesBlock = pages
    .map((p) =>
      [
        '  <page>',
        `    <source_name>${p.sourceName}</source_name>`,
        `    <source_url>${p.sourceUrl}</source_url>`,
        '    <content>',
        p.pageText,
        '    </content>',
        '  </page>',
      ].join('\n'),
    )
    .join('\n');

  const user = [
    '<pages>',
    pagesBlock,
    '</pages>',
    '',
    '<query>',
    `  <city>${city}</city>`,
    `  <text>${queryText}</text>`,
    `  <timeframe from="${timeframe.from}" to="${timeframe.to}" />`,
    '</query>',
  ].join('\n');

  return { system, user };
}
