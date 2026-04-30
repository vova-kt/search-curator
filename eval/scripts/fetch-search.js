#!/usr/bin/env node
/**
 * fetch-search.js — manual one-shot.
 *
 * Runs a real search adapter against one or more queries and writes the results
 * to `eval/fixtures/<slug>.search.json`. The fixture freezes the timeframe and
 * query parameters so downstream eval scripts (run-extract, future run-rank)
 * are reproducible without re-hitting the search API.
 *
 * Without `--expand`, a single literal "<queryText> <city>" query is used.
 * Pass `--expand templates` to fan out via the templates query-expansion
 * strategy (4 deterministic phrasings, no LLM). Pass `--expand llm` to use
 * llmExpand (requires OPENAI_API_KEY; pass `--model <id>` to override the
 * default gpt-4o-mini). Results across all queries are merged and deduplicated
 * by URL before writing the fixture.
 *
 * Usage:
 *   node eval/scripts/fetch-search.js \
 *     --query "standup comedy in russian" \
 *     --city "New York" \
 *     --days 90 \
 *     --search tavily \
 *     [--expand templates|llm] [--model <id>] [--max-results 20] [--force]
 */

import { tavily } from '../../src/adapters/search/tavily.js';
import { firecrawl } from '../../src/adapters/search/firecrawl.js';
import { templates } from '../../src/strategies/queryExpansion/templates.js';
import { llmExpand } from '../../src/strategies/queryExpansion/llmExpand.js';
import { parseArgs, requireString, requireNumber, flag, requireEnv } from '../core/cli.js';
import { makeSlug } from '../core/slug.js';
import { writeSearchFixture } from '../core/fixtures.js';
import { buildExpandCtx } from '../core/ctx.js';
import {DEFAULTS} from "../../src/index.js";

const args = parseArgs(process.argv.slice(2));

try {
  const queryText = requireString(args, 'query');
  const city = requireString(args, 'city');
  const days = requireNumber(args, 'days');
  const which = requireString(args, 'search');
  const maxResults = typeof args['max-results'] === 'string' ? Number(args['max-results']) : 20;
  const force = flag(args, 'force');
  const expand = typeof args.expand === 'string' ? args.expand : null;

  const adapter = buildSearchAdapter(which);

  const today = new Date();
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() + days);
  const timeframe = { from: isoDate(today), to: isoDate(to) };

  const slug = makeSlug({ queryText, city, days, from: timeframe.from });

  let queries;
  if (expand) {
    const strategy = buildExpandStrategy(expand);
    const model = typeof args.model === 'string' ? args.model : DEFAULTS.llm.model;
    const expandCtx = buildExpandCtx({
      query: { city, queryText, timeframe },
      ...(expand === 'llm' ? { apiKey: requireEnv('OPENAI_API_KEY'), model } : {}),
    });
    queries = await strategy(expandCtx);
    console.log(`expanded to ${queries.length} queries via ${expand}`);
  } else {
    queries = [`${queryText} ${city}`];
  }

  console.log(`fetching: adapter=${which} queries=${queries.length} max=${maxResults}`);
  const allHitsArrays = await Promise.all(queries.map((q) => adapter.search(q, { maxResults })));
  const seen = new Set();
  const hits = allHitsArrays.flat().filter((h) => {
    if (seen.has(h.url)) return false;
    seen.add(h.url);
    return true;
  });
  const totalRaw = allHitsArrays.reduce((s, a) => s + a.length, 0);
  console.log(`got ${hits.length} hits (${totalRaw} total, ${totalRaw - hits.length} deduped by url)`);

  const path = writeSearchFixture(
    {
      slug,
      query: { city, queryText },
      timeframe,
      fetchedAt: new Date().toISOString(),
      search: { adapter: which, queries },
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

/**
 * @param {string} name
 * @returns {import('../../src/core/types.js').QueryExpansionStrategy}
 */
function buildExpandStrategy(name) {
  switch (name) {
    case 'templates':
      return templates();
    case 'llm':
      return llmExpand();
    default:
      throw new Error(`unknown --expand ${name}; supported: templates, llm`);
  }
}

/** @param {Date} d */
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
