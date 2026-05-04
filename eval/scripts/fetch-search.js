#!/usr/bin/env node
/**
 * fetch-search.js — batch search fixture generator.
 *
 * Runs a real search adapter against one or more (query, city) pairs and writes
 * results to `eval/fixtures/search/<slug>.search.json`. Each fixture freezes the
 * timeframe and query parameters so downstream eval scripts (run-extract,
 * future run-rank) are reproducible without re-hitting the search API.
 *
 * With `expand: null`, a single literal "<query> <city>" search is issued.
 * `expand: 'templates'` fans out via 4 deterministic phrasings (no LLM).
 * `expand: 'llm'` uses llmExpand (requires OPENAI_API_KEY). Results across
 * all queries are merged and deduplicated by URL before writing the fixture.
 *
 * Configure the `shared` and `queries` blocks below, then run:
 *   node --env-file=.env.dev eval/scripts/fetch-search.js
 */

import { tavily } from '../../src/adapters/search/tavily.js';
import { firecrawl } from '../../src/adapters/search/firecrawl.js';
import { templates, llmExpand } from '../../src/strategies/queryExpansion/index.js';
import { requireEnv } from '../core/env.js';
import { makeSlug } from '../core/slug.js';
import { writeSearchFixture } from '../core/fixtures.js';
import { createEvalContext } from '../core/ctx.js';
import { DEFAULTS } from '../../src/index.js';
import { dedupeByUrl } from '../../src/stages/discover.js';

/** Shared settings applied to every query. */
const shared = {
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
  /** Overwrite existing <slug>.search.json files. */
  force: false,
};

/** Each entry produces one <slug>.search.json fixture. */
const queries = [
  { query: 'standup comedy in Russian', city: 'Berlin' },
  { query: 'jazz concert',              city: 'New York' },
  { query: 'tech meetup AI',            city: 'San Francisco' },
  { query: 'salsa bachata social',      city: 'Barcelona' },
  { query: 'indie film screening',      city: 'Amsterdam' },
  { query: 'yoga retreat weekend',      city: 'Lisbon' },
  { query: 'startup pitch night',       city: 'London' },
  { query: 'contemporary art exhibition', city: 'Paris' },
];

// ── run ─────────────────────────────────────────────────────────────────

const adapter = buildSearchAdapter(shared.searchProvider);
const expandStrategy = shared.expand ? buildExpandStrategy(shared.expand) : null;

const today = new Date();
const to = new Date(today);
to.setUTCDate(to.getUTCDate() + shared.days);
const timeframe = { from: isoDate(today), to: isoDate(to) };

let ok = 0;
let fail = 0;

for (const { query, city } of queries) {
  const i = ok + fail + 1;
  const label = `"${query}" in ${city}`;
  try {
    const slug = makeSlug({ queryText: query, city, days: shared.days, from: timeframe.from });

    let searchQueries;
    const expandQuery = { city, queryText: query, timeframe };
    if (expandStrategy) {
      const expandCtx = createEvalContext({
        apiKey: requireEnv('OPENAI_API_KEY'),
        qeMaxQueries: shared.maxResults,
        qeModel: shared.model,
      });
      const result = await expandStrategy(expandCtx, expandQuery);
      searchQueries = result.queries;
      console.log(`[${i}/${queries.length}] ${label}: expanded to ${searchQueries.length} queries via ${shared.expand}`);
    } else {
      searchQueries = [`${query} ${city}`];
      console.log(`[${i}/${queries.length}] ${label}: 1 literal query`);
    }

    console.log(`  fetching: ${searchQueries.length} queries × max ${shared.maxResults}`);
    const allHitsArrays = await Promise.all(
      searchQueries.map((q) => adapter.search(q, { maxResults: shared.maxResults })),
    );
    const allHits = allHitsArrays.flat();
    const hits = dedupeByUrl(allHits);
    console.log(`  total ${allHits.length} → deduped ${hits.length}`);

    const path = writeSearchFixture(
      {
        slug,
        query: { city, queryText: query },
        timeframe,
        fetchedAt: new Date().toISOString(),
        search: { adapter: shared.searchProvider, queries: searchQueries },
        hits,
      },
      { force: shared.force },
    );
    console.log(`  wrote ${path}\n`);
    ok++;
  } catch (err) {
    console.error(`  FAILED ${label}: ${err instanceof Error ? err.message : err}\n`);
    fail++;
  }
}

console.log(`done: ${ok} ok, ${fail} failed out of ${queries.length}`);
if (fail > 0) process.exit(1);

// ── helpers ─────────────────────────────────────────────────────────────

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
      throw new Error(`unknown search=${name}; supported: tavily, firecrawl`);
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
      throw new Error(`unknown expand=${name}; supported: templates, llm`);
  }
}

/** @param {Date} d */
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
