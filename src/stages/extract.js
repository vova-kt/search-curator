/**
 * Extract stage: turn SearchHits into structured Events via the LLM.
 *
 * Hits are grouped into batches whose combined estimated input tokens
 * stay within `pipeline.batchInputTokens`. Tokens are estimated as
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
 * @typedef {Object} ExtractOpts
 * @property {string[]} [expandedQueries]
 * @property {AbortSignal} [signal]
 * @property {import('../core/types.js').ProgressListener} [onProgress]
 */

/**
 * @param {import('../core/types.js').SearchHit[]} hits
 * @param {import('../core/types.js').Ctx} ctx
 * @param {import('../core/types.js').Query} query
 * @param {ExtractOpts} [opts]
 * @returns {Promise<{ events: import('../core/types.js').Event[], usage: import('../core/types.js').LLMUsage }>}
 */
export async function extract(hits, ctx, query, opts) {
  const timeframe = resolveTimeframe(
    query.timeframe,
    ctx.config.pipeline.defaultRollingDays,
  );
  const maxWorkers = ctx.config.pipeline.maxWorkers;
  const batchTokenCap = ctx.config.llm.batchInputTokens;
  const charsPerToken = ctx.config.llm.charsPerToken;
  const emit = opts?.onProgress ?? (() => {});
  const signal = opts?.signal;

  const expandedQueries = opts?.expandedQueries ?? [];
  const pages = preparePages(hits);
  const batches = batchPages(pages, batchTokenCap, charsPerToken);
  const log = ctx.logger;
  log.debug(
    `[extract] ${hits.length} hits → ${pages.length} pages → ${batches.length} batches (maxWorkers=${maxWorkers}, batchTokenCap=${batchTokenCap})`,
  );

  /** @type {import('../core/types.js').Event[]} */
  const out = [];
  let totalInput = 0;
  let totalOutput = 0;
  let cursor = 0;
  let processed = hits.length - pages.length;
  if (processed > 0) {
    emit({
      stage: ProgressStage.EXTRACT,
      phase: ProgressPhase.TICK,
      current: processed,
      total: hits.length,
    });
  }

  /** @returns {Promise<void>} */
  async function worker() {
    while (cursor < batches.length) {
      const i = cursor++;
      const batch = batches[i];
      try {
        const result = await extractFromBatch(batch, ctx, query, timeframe, expandedQueries, signal);
        log.debug(
          `[extract] batch ${i + 1}/${batches.length} (${batch.length} pages) → ${result.events.length} events`,
        );
        out.push(...result.events);
        totalInput += result.usage.inputTokens;
        totalOutput += result.usage.outputTokens;
      } catch (err) {
        log.warn(
          `[extract] batch failed (${batch.length} pages):`,
          err instanceof Error ? err.message : err,
        );
      }
      processed += batch.length;
      emit({
        stage: ProgressStage.EXTRACT,
        phase: ProgressPhase.TICK,
        current: processed,
        total: hits.length,
      });
    }
  }

  const workers = Array.from({ length: Math.min(maxWorkers, batches.length) }, worker);
  await Promise.all(workers);

  const before = out.length;
  const cleaned = dedupeAndFilter(out, timeframe);
  if (cleaned.length < before) {
    log.debug(
      `[extract] post-filter: ${before} → ${cleaned.length} (${before - cleaned.length} dropped: dupes or out-of-range)`,
    );
  }
  return { events: cleaned, usage: { inputTokens: totalInput, outputTokens: totalOutput } };
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
 * @param {import('../core/types.js').Query} query
 * @param {{ from: string, to: string }} timeframe
 * @param {string[]} expandedQueries
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ events: import('../core/types.js').Event[], usage: import('../core/types.js').LLMUsage }>}
 */
async function extractFromBatch(batch, ctx, query, timeframe, expandedQueries, signal) {
  const prompt = extractEventsPrompt({
    city: query.city,
    queryText: query.queryText,
    timeframe,
    expandedQueries,
    pages: batch.map(({ hit, pageText }) => ({
      sourceName: hit.source,
      sourceUrl: hit.url,
      pageText,
    })),
  });

  const resp = await ctx.llm.chat({
    model: ctx.config.eventExtraction.model,
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    json: true,
    temperature: ctx.config.eventExtraction.temperature,
    maxTokens: ctx.config.llm.maxTokens,
    maxRetries: ctx.config.llm.maxRetries,
    signal,
  });

  const json =
    /** @type {{ events?: Array<Partial<import('../core/types.js').Event>> }} */ (
      resp.json ?? {}
    );
  const raws = Array.isArray(json.events) ? json.events : [];
  const fetchedAt = new Date().toISOString();

  /** @type {import('../core/types.js').Event[]} */
  const events = [];
  for (const r of raws) {
    if (!r.title || !r.startsAt || !r.venue?.name || !r.venue?.city) continue;
    if (!r.source?.name || !r.source?.url) continue;
    if (!r.score) continue;
    events.push({
      id: eventId({ title: r.title, startsAt: r.startsAt, venue: r.venue }),
      title: r.title,
      deduplicationKey: r.deduplicationKey,
      description: r.description,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      venue: r.venue,
      source: { name: r.source.name, url: r.source.url, fetchedAt },
      price: r.price,
      reason: r.reason,
      score: r.score,
      ...(Array.isArray(r.occurrences) && r.occurrences.length > 1
        ? { occurrences: r.occurrences }
        : {}),
    });
  }
  return { events, usage: resp.usage };
}

/**
 * Drop duplicates (by eventId) and events whose startsAt falls outside the
 * resolved timeframe. First occurrence wins.
 *
 * @param {import('../core/types.js').Event[]} events
 * @param {{ from: string, to: string }} timeframe
 * @returns {import('../core/types.js').Event[]}
 */
function dedupeAndFilter(events, timeframe) {
  const fromMs = Date.parse(timeframe.from);
  const toMs = Date.parse(timeframe.to + 'T23:59:59Z');
  /** @type {Map<string, import('../core/types.js').Event>} */
  const seen = new Map();
  for (const e of events) {
    const key = e.deduplicationKey || e.id;
    if (seen.has(key)) continue;
    const ms = Date.parse(e.startsAt);
    if (!Number.isNaN(ms) && (ms < fromMs || ms > toMs)) continue;
    seen.set(key, e);
  }
  return [...seen.values()];
}
