/**
 * Discover stage: build search queries via queryExpansion strategies,
 * fan across search adapters, return SearchHit[].
 * See docs/pipeline.md.
 */

import { ProgressStage, ProgressPhase } from '../core/progress.js';

/**
 * @param {import('../core/types.js').Ctx} ctx
 * @returns {Promise<import('../core/types.js').SearchHit[]>}
 */
export async function discover(ctx) {
  const emit = ctx.onProgress ?? (() => {});

  emit({ stage: ProgressStage.QUERIES, phase: ProgressPhase.START });
  const queries = await buildQueries(ctx);
  emit({ stage: ProgressStage.QUERIES, phase: ProgressPhase.DONE, count: queries.length });

  const total = ctx.search.length * queries.length;
  emit({ stage: ProgressStage.SEARCH, phase: ProgressPhase.START, total });

  /** @type {import('../core/types.js').SearchHit[]} */
  const all = [];
  let current = 0;
  for (const adapter of ctx.search) {
    for (const q of queries) {
      try {
        const hits = await adapter.search(q, {
          maxResults: ctx.config.search.maxResultsPerAdapter,
          signal: ctx.signal,
        });
        all.push(...hits);
      } catch (err) {
        // One adapter or query failing should not kill discovery.
        // Surface via console so the operator notices.
        // eslint-disable-next-line no-console
        console.warn(`[discover] ${adapter.name} failed for "${q}":`, err instanceof Error ? err.message : err);
      }
      current++;
      emit({ stage: ProgressStage.SEARCH, phase: ProgressPhase.TICK, current, total, note: adapter.name });
    }
  }
  const deduped = dedupeByUrl(all);
  emit({ stage: ProgressStage.SEARCH, phase: ProgressPhase.DONE, count: deduped.length });
  return deduped;
}

/**
 * @param {import('../core/types.js').Ctx} ctx
 * @returns {Promise<string[]>}
 */
async function buildQueries(ctx) {
  const strategies = ctx.strategies.queryExpansion;
  if (!strategies || strategies.length === 0) {
    throw new Error('discover: no queryExpansion strategies configured');
  }
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const strat of strategies) {
    let produced;
    try {
      produced = await strat(ctx);
    } catch (err) {
      // Mirrors the per-adapter error policy: a single strategy failure should not kill discovery.
      // eslint-disable-next-line no-console
      console.warn('[discover] queryExpansion strategy failed:', err instanceof Error ? err.message : err);
      continue;
    }
    for (const q of produced ?? []) {
      const key = q.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.set(key, q.trim());
    }
  }
  return [...seen.values()];
}

/**
 * @param {import('../core/types.js').SearchHit[]} hits
 */
function dedupeByUrl(hits) {
  /** @type {Map<string, import('../core/types.js').SearchHit>} */
  const seen = new Map();
  for (const h of hits) {
    if (!seen.has(h.url)) seen.set(h.url, h);
  }
  return [...seen.values()];
}
