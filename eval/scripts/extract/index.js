#!/usr/bin/env node
/**
 * extract eval — extraction evaluation.
 *
 * Loads every `<slug>.search.json` fixture, calls `extract(hits, ctx)` directly
 * with a real LLM, and renders a consolidated metric report against
 * `<slug>.golden.json` files. Writes run records to
 * `eval/runs/<slug>__<ts>.json` for offline diffing. When no golden file exists
 * the extracted events are auto-promoted to a new golden file.
 *
 * All fixtures are processed concurrently (Promise.allSettled).
 *
 * Configure model/temperature below. Run:
 *   node --env-file=.env.dev eval/scripts/extract/index.js
 */

import { requireEnv } from '../../core/env.js';
import { listSearchSlugs } from '../../core/fixtures.js';
import { runOne } from './runner.js';
import { printReport } from './report.js';

const config = {
  model: 'gpt-5.4-mini',
  temperature: 0,
  reasoningEffort: null,
  // model: 'gpt-5.5',
  // temperature: 1,
  // reasoningEffort: /** @type {'low'|'medium'|'high'} */ ('high'),
};

try {
  const apiKey = requireEnv('OPENAI_API_KEY');
  const slugs = listSearchSlugs().filter((slug) => slug.includes('berlin'));

  if (slugs.length === 0) {
    console.log('no *.search.json fixtures found');
    process.exit(0);
  }

  const results = await Promise.allSettled(slugs.map((slug) => runOne(slug, apiKey, config)));

  printReport(slugs, results, config);
} catch (err) {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
}
