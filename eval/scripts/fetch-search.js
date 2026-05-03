#!/usr/bin/env node
/**
 * fetch-search.js — manual one-shot.
 *
 * Runs a real search adapter against one or more queries and writes the results
 * to `eval/fixtures/<slug>.search.json`. The fixture freezes the timeframe and
 * query parameters so downstream eval scripts (run-extract, future run-rank)
 * are reproducible without re-hitting the search API.
 *
 * With `expand: null`, a single literal "<query> <city>" search is issued.
 * `expand: 'templates'` fans out via 4 deterministic phrasings (no LLM).
 * `expand: 'llm'` uses llmExpand (requires OPENAI_API_KEY). Results across
 * all queries are merged and deduplicated by URL before writing the fixture.
 *
 * Configure in [eval/config.js](../config.js) → `fetchSearch`. Run:
 *   node --env-file=.env.dev eval/scripts/fetch-search.js
 */

import { tavily } from '../../src/adapters/search/tavily.js';
import { firecrawl } from '../../src/adapters/search/firecrawl.js';
import { templates, llmExpand } from '../../src/strategies/queryExpansion/index.js';
import { requireEnv } from '../core/env.js';
import { makeSlug } from '../core/slug.js';
import { writeSearchFixture } from '../core/fixtures.js';
import { buildExpandCtx } from '../core/ctx.js';
import {DEFAULTS} from "../../src/index.js";
import {dedupeByUrl} from '../../src/stages/discover.js'

const config = {
  query: 'standup comedy in Russian',
  city: 'Berlin',
  days: 90,
  /** @type {'tavily' | 'firecrawl'} */
  searchProvider: 'tavily',
  /**
   * null = single literal "<query> <city>" search;
   * 'templates' = 4 deterministic phrasings (no LLM);
   * 'llm' = llmExpand strategy (requires OPENAI_API_KEY).
   * @type {'templates' | 'llm' | null}
   */
  expand: 'llm',
  /** Used only when expand === 'llm'. */
  model: DEFAULTS.llm.model,
  maxResults: 20,
  /** Overwrite an existing <slug>.search.json. */
  force: false,
}

try {
  const adapter = buildSearchAdapter(config.searchProvider);

  const today = new Date();
  const to = new Date(today);
  to.setUTCDate(to.getUTCDate() + config.days);
  const timeframe = { from: isoDate(today), to: isoDate(to) };

  const slug = makeSlug({
      queryText: config.query,
      city: config.city,
      days: config.days,
      from: timeframe.from
  });

  let queries;
  if (config.expand) {
    const strategy = buildExpandStrategy(config.expand);
    const expandCtx = buildExpandCtx({
      query: { city: config.city, queryText: config.query, timeframe },
      ...(config.expand === 'llm' ? { apiKey: requireEnv('OPENAI_API_KEY'), model: config.model } : {}),
    });
    queries = await strategy(expandCtx);
    console.log(`expanded to ${queries.length} queries via ${config.expand}`);
  } else {
    queries = [`${config.queryText} ${config.city}`];
  }

  console.log(`fetching: adapter=${config.searchProvider} queries=${queries.length} max=${config.maxResults}`);
  const allHitsArrays = await Promise.all(queries.map((q) => adapter.search(q, { maxResults: config.maxResults })));
  const allHits = allHitsArrays.flat()
  const hits = dedupeByUrl(allHits)
  console.log(`total hits ${allHits.length}, deduped to ${hits.length}`);

  const path = writeSearchFixture(
    {
      slug,
      query: { city: config.city, queryText: config.query },
      timeframe,
      fetchedAt: new Date().toISOString(),
      search: { adapter: config.searchProvider, queries },
      hits,
    },
    { force: config.force },
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
      throw new Error(`unknown search=${name} in config.fetchSearch; supported: tavily, firecrawl`);
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
      throw new Error(`unknown expand=${name} in config.fetchSearch; supported: templates, llm`);
  }
}

/** @param {Date} d */
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
