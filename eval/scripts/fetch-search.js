#!/usr/bin/env node
/**
 * fetch-search.js — manual one-shot.
 *
 * Runs a real search adapter against a single literal query and writes the
 * results to `eval/fixtures/<slug>.search.json`. The fixture freezes the
 * timeframe and the query parameters so downstream eval scripts (run-extract,
 * future run-rank) are reproducible without re-hitting the search API.
 *
 * No multi-query expansion in v1 — keeps fixtures small and the extraction
 * signal clean. Add `--queries-file` later when needed.
 *
 * Usage:
 *   node eval/scripts/fetch-search.js \
 *     --query "standup comedy in russian" \
 *     --city "New York" \
 *     --days 90 \
 *     --search tavily \
 *     [--max-results 20] [--force]
 */

import { tavily } from '../../src/adapters/search/tavily.js';
import { firecrawl } from '../../src/adapters/search/firecrawl.js';
import { parseArgs, requireString, requireNumber, flag, requireEnv } from '../core/cli.js';
import { makeSlug } from '../core/slug.js';
import { writeSearchFixture } from '../core/fixtures.js';

const args = parseArgs(process.argv.slice(2));

try {
  const queryText = requireString(args, 'query');
  const city = requireString(args, 'city');
  const days = requireNumber(args, 'days');
  const which = requireString(args, 'search');
  const maxResults = typeof args['max-results'] === 'string' ? Number(args['max-results']) : 20;
  const force = flag(args, 'force');

  const adapter = buildSearchAdapter(which);

  const today = new Date();
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() + days);
  const timeframe = { from: isoDate(today), to: isoDate(to) };

  const slug = makeSlug({ queryText, city, days, from: timeframe.from });
  const literal = `${queryText} ${city}`;

  console.log(`fetching: adapter=${which} query="${literal}" max=${maxResults}`);
  const hits = await adapter.search(literal, { maxResults });
  console.log(`got ${hits.length} hits`);

  const path = writeSearchFixture(
    {
      slug,
      query: { city, queryText },
      timeframe,
      fetchedAt: new Date().toISOString(),
      search: { adapter: which, queries: [literal] },
      hits,
    },
    { force },
  );
  console.log(`wrote ${path}`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

/**
 * @param {string} name
 * @returns {import('../../src/core/types.js').SearchAdapter}
 */
function buildSearchAdapter(name) {
  switch (name) {
    case 'tavily':
      return tavily({ apiKey: requireEnv('TAVILY_API_KEY') });
    case 'firecrawl':
      return firecrawl({ apiKey: requireEnv('FIRECRAWL_API_KEY') });
    default:
      throw new Error(`unknown --search ${name}; supported: tavily, firecrawl`);
  }
}

/** @param {Date} d */
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
