#!/usr/bin/env node
/**
 * One-shot example. See docs/examples.md.
 */

import { createCurator } from '../src/index.js';
import { sqlite } from '../src/adapters/storage/sqlite.js';
import { memory } from '../src/adapters/storage/memory.js';
import { openai } from '../src/adapters/llm/openai.js';
import { tavily } from '../src/adapters/search/tavily.js';
import { stubLLM, stubSearch } from './_stubs.js';

const args = parseArgs(process.argv.slice(2));

if (!args.city || !args.query) {
  console.error('Usage: node examples/script.js --city <city> --query <text> [--days N | --from ISO --to ISO] [--limit N] [--guidance text] [--db path] [--dry]');
  process.exit(1);
}

const dry = args.dry === 'true' || args.dry === '';

const llm = dry
  ? stubLLM()
  : openai({ apiKey: requireEnv('OPENAI_API_KEY'), model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini' });

const search = dry ? [stubSearch()] : [tavily({ apiKey: requireEnv('TAVILY_API_KEY') })];

const storage = dry
  ? memory()
  : sqlite({ path: args.db ?? process.env.EVENTS_DB_PATH ?? './events.db' });

const curator = await createCurator({ llm, search, storage });

const timeframe = args.from && args.to
  ? { from: args.from, to: args.to }
  : { rolling: { days: Number(args.days ?? 14) } };

const { events } = await curator.curate({
  city: args.city,
  queryText: args.query,
  timeframe,
  limit: Number(args.limit ?? 10),
  guidance: args.guidance,
});

if (events.length === 0) {
  console.log('(no events found)');
} else {
  for (const [i, e] of events.entries()) {
    const date = e.startsAt.slice(0, 16).replace('T', ' ');
    const price = e.price?.free ? 'free' : e.price?.min !== undefined ? `${e.price.min}${e.price.currency ? ' ' + e.price.currency : ''}` : '';
    console.log(`[${i + 1}] ${date}  ${e.title}  —  ${e.venue.name}${price ? ` (${price})` : ''}`);
    if (e.rationale) console.log(`     ↳ ${e.rationale}`);
  }
}

await curator.close();

/**
 * @param {string[]} argv
 * @returns {Record<string, string>}
 */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = '';
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/**
 * @param {string} name
 */
function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}
