/**
 * Extract stage: turn SearchHits into structured Events via the LLM.
 * Per-hit failures are isolated so one broken page doesn't fail the run.
 * See docs/pipeline.md.
 */

import { extractEventsPrompt } from '../prompts/extractEvents.js';
import { eventId } from '../core/identity.js';
import { resolveTimeframe } from '../core/timeframe.js';
import { ProgressStage, ProgressPhase } from '../core/progress.js';

/**
 * @param {import('../core/types.js').SearchHit[]} hits
 * @param {import('../core/types.js').Ctx} ctx
 * @returns {Promise<import('../core/types.js').Event[]>}
 */
export async function extract(hits, ctx) {
  const timeframe = resolveTimeframe(ctx.query.timeframe, ctx.config.pipeline.defaultRollingDays);
  const concurrency = ctx.config.pipeline.extractConcurrency;
  const emit = ctx.onProgress ?? (() => {});

  /** @type {import('../core/types.js').Event[]} */
  const out = [];
  let cursor = 0;
  let processed = 0;

  /** @returns {Promise<void>} */
  async function worker() {
    while (cursor < hits.length) {
      const i = cursor++;
      const hit = hits[i];
      try {
        const events = await extractFromHit(hit, ctx, timeframe);
        out.push(...events);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`[extract] failed for ${hit.url}:`, err instanceof Error ? err.message : err);
      }
      processed++;
      emit({ stage: ProgressStage.EXTRACT, phase: ProgressPhase.TICK, current: processed, total: hits.length });
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, hits.length) }, worker);
  await Promise.all(workers);
  return out;
}

/**
 * @param {import('../core/types.js').SearchHit} hit
 * @param {import('../core/types.js').Ctx} ctx
 * @param {{ from: string, to: string }} timeframe
 * @returns {Promise<import('../core/types.js').Event[]>}
 */
async function extractFromHit(hit, ctx, timeframe) {
  const pageText = hit.content ?? hit.snippet ?? '';
  if (!pageText.trim()) return [];

  const prompt = extractEventsPrompt({
    city: ctx.query.city,
    category: String(ctx.query.category),
    timeframe,
    pageText,
    sourceUrl: hit.url,
  });

  const resp = await ctx.llm.chat({
    system: prompt.system,
    messages: [{ role: 'user', content: prompt.user }],
    json: true,
    signal: ctx.signal,
  });

  const json = /** @type {{ events?: Array<Partial<import('../core/types.js').Event>> }} */ (resp.json ?? {});
  const raws = Array.isArray(json.events) ? json.events : [];
  const fetchedAt = new Date().toISOString();

  /** @type {import('../core/types.js').Event[]} */
  const events = [];
  for (const r of raws) {
    if (!r.title || !r.startsAt || !r.venue?.name || !r.venue?.city) continue;
    events.push({
      id: eventId({ title: r.title, startsAt: r.startsAt, venue: r.venue }),
      title: r.title,
      description: r.description,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      venue: r.venue,
      category: r.category ?? ctx.query.category,
      subcategories: r.subcategories,
      source: { name: hit.source, url: hit.url, fetchedAt },
      price: r.price,
      raw: pageText.slice(0, 1000),
    });
  }
  return events;
}
