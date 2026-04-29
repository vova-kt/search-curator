/**
 * Extract stage: turn SearchHits into structured Events via the LLM.
 *
 * Hits are grouped into batches whose combined estimated input tokens
 * stay within `pipeline.extractBatchTokenCap`. Tokens are estimated as
 * ceil(chars / pipeline.charsPerToken). Each batch is one LLM call.
 *
 * The LLM echoes each page's source name and URL back on every event it
 * yields, so we don't need to map events to input pages ourselves.
 *
 * Per-batch failures are isolated so one broken request doesn't fail the run.
 * See docs/pipeline.md.
 */

import { extractEventsPrompt } from '../prompts/index.js';
import { eventId } from '../core/identity.js';
import { resolveTimeframe } from '../core/timeframe.js';
import { ProgressStage, ProgressPhase } from '../core/progress.js';

/**
 * @typedef {{ hit: import('../core/types.js').SearchHit, pageText: string }} PreparedPage
 */

/**
 * @param {import('../core/types.js').SearchHit[]} hits
 * @param {import('../core/types.js').Ctx} ctx
 * @returns {Promise<import('../core/types.js').Event[]>}
 */
export async function extract(hits, ctx) {
  const timeframe = resolveTimeframe(ctx.query.timeframe, ctx.config.pipeline.defaultRollingDays);
  const concurrency = ctx.config.pipeline.extractConcurrency;
  const batchTokenCap = ctx.config.pipeline.extractBatchTokenCap;
  const charsPerToken = ctx.config.pipeline.charsPerToken;
  const emit = ctx.onProgress ?? (() => {});

  const pages = preparePages(hits);
  const batches = batchPages(pages, batchTokenCap, charsPerToken);

  /** @type {import('../core/types.js').Event[]} */
  const out = [];
  let cursor = 0;
  let processed = hits.length - pages.length;
  if (processed > 0) {
    emit({ stage: ProgressStage.EXTRACT, phase: ProgressPhase.TICK, current: processed, total: hits.length });
  }

  /** @returns {Promise<void>} */
  async function worker() {
    while (cursor < batches.length) {
      const i = cursor++;
      const batch = batches[i];
      try {
        const events = await extractFromBatch(batch, ctx, timeframe);
        out.push(...events);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[extract] batch failed (${batch.length} pages):`,
          err instanceof Error ? err.message : err,
        );
      }
      processed += batch.length;
      emit({ stage: ProgressStage.EXTRACT, phase: ProgressPhase.TICK, current: processed, total: hits.length });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, batches.length) }, worker);
  await Promise.all(workers);
  return out;
}

/**
 * @param {import('../core/types.js').SearchHit[]} hits
 * @returns {PreparedPage[]}
 */
function preparePages(hits) {
  /** @type {PreparedPage[]} */
  const out = [];
  for (const hit of hits) {
    const text = hit.snippet ?? hit.content ?? '';
    if (!text.trim()) continue;
    out.push({ hit, pageText: text });
  }
  return out;
}

/**
 * Greedy bin-packing: append pages to the current batch until adding another
 * would exceed the token cap, then start a new batch. A single oversized page
 * lands alone in its own batch.
 *
 * @param {PreparedPage[]} pages
 * @param {number} batchTokenCap
 * @param {number} charsPerToken
 * @returns {PreparedPage[][]}
 */
function batchPages(pages, batchTokenCap, charsPerToken) {
  /** @type {PreparedPage[][]} */
  const batches = [];
  /** @type {PreparedPage[]} */
  let current = [];
  let currentTokens = 0;
  for (const page of pages) {
    const tokens = Math.ceil(page.pageText.length / charsPerToken);
    if (current.length > 0 && currentTokens + tokens > batchTokenCap) {
      batches.push(current);
      current = [];
      currentTokens = 0;
    }
    current.push(page);
    currentTokens += tokens;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * @param {PreparedPage[]} batch
 * @param {import('../core/types.js').Ctx} ctx
 * @param {{ from: string, to: string }} timeframe
 * @returns {Promise<import('../core/types.js').Event[]>}
 */
async function extractFromBatch(batch, ctx, timeframe) {
  const prompt = extractEventsPrompt({
    city: ctx.query.city,
    queryText: ctx.query.queryText,
    timeframe,
    pages: batch.map(({ hit, pageText }) => ({
      sourceName: hit.source,
      sourceUrl: hit.url,
      pageText,
    })),
  });

  const resp = await ctx.llm.chat({
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    json: true,
    signal: ctx.signal,
  });

  const json = /** @type {{ events?: Array<Partial<import('../core/types.js').Event>> }} */ (
    resp.json ?? {}
  );
  const raws = Array.isArray(json.events) ? json.events : [];
  const fetchedAt = new Date().toISOString();

  /** @type {import('../core/types.js').Event[]} */
  const events = [];
  for (const r of raws) {
    if (!r.title || !r.startsAt || !r.venue?.name || !r.venue?.city) continue;
    if (!r.source?.name || !r.source?.url) continue;
    events.push({
      id: eventId({ title: r.title, startsAt: r.startsAt, venue: r.venue }),
      title: r.title,
      description: r.description,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      venue: r.venue,
      subcategories: r.subcategories,
      source: { name: r.source.name, url: r.source.url, fetchedAt },
      price: r.price,
    });
  }
  return events;
}
