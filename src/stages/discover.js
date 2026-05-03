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
  const log = ctx.logger;

  emit({ stage: ProgressStage.QUERIES, phase: ProgressPhase.START });
  const queries = await buildQueries(ctx);
  emit({ stage: ProgressStage.QUERIES, phase: ProgressPhase.DONE, count: queries.length });
  log.debug('[discover] queries', queries);

  const total = ctx.search.length * queries.length;
  emit({ stage: ProgressStage.SEARCH, phase: ProgressPhase.START, total });

  let current = 0;
  /** @type {Promise<import('../core/types.js').SearchHit[]>[]} */
  const tasks = [];
  for (const adapter of ctx.search) {
    for (const q of queries) {
      tasks.push((async () => {
        try {
          return await adapter.search(q, {
            maxResults: ctx.config.search.maxResultsPerAdapter,
            signal: ctx.signal,
          });
        } catch (err) {
          // One adapter or query failing should not kill discovery.
          log.warn(`[discover] ${adapter.name} failed for "${q}":`, err instanceof Error ? err.message : err);
          return [];
        } finally {
          current++;
          emit({ stage: ProgressStage.SEARCH, phase: ProgressPhase.TICK, current, total, note: adapter.name });
        }
      })());
    }
  }
  const all = (await Promise.all(tasks)).flat();
  const deduped = dedupeByUrl(all);
  emit({ stage: ProgressStage.SEARCH, phase: ProgressPhase.DONE, count: deduped.length });
  log.debug(`[discover] ${all.length} raw hits → ${deduped.length} after url-dedupe`);
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
  const settled = await Promise.allSettled(strategies.map(async (s) => s(ctx)));
  /** @type {Map<string, string>} */
  const seen = new Map();
  for (const r of settled) {
    if (r.status === 'rejected') {
      // Mirrors the per-adapter error policy: a single strategy failure should not kill discovery.
      ctx.logger.warn('[discover] queryExpansion strategy failed:', r.reason instanceof Error ? r.reason.message : r.reason);
      continue;
    }
    for (const q of r.value ?? []) {
      const key = q.trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.set(key, q.trim());
    }
  }
  return [...seen.values()];
}

const TRACKING_PARAM_PREFIXES = ['utm_'];
const TRACKING_PARAM_NAMES = new Set([
  'fbclid',
  'srsltid',
  'gclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'mc_cid',
  'mc_eid',
  'yclid',
  'igshid',
  '_hsenc',
  '_hsmi',
  'ref',
  'ref_src',
  'ref_url',
]);

/**
 * Canonicalize a URL so cosmetically-different links to the same page collapse:
 * lowercase scheme+host, strip `www.`, drop fragment, drop tracking query params,
 * remove trailing slash on the path. Returns the original string on parse failure
 * so non-URL ids still dedupe by exact match.
 * @param {string} url
 * @returns {string}
 */
function canonicalizeUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  u.hash = '';
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
  for (const key of [...u.searchParams.keys()]) {
    const lower = key.toLowerCase();
    if (TRACKING_PARAM_NAMES.has(lower) || TRACKING_PARAM_PREFIXES.some((p) => lower.startsWith(p))) {
      u.searchParams.delete(key);
    }
  }
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.replace(/\/+$/, '');
  }
  return u.toString();
}

/**
 * @param {import('../core/types.js').SearchHit[]} hits
 */
export function dedupeByUrl(hits) {
  /** @type {Map<string, import('../core/types.js').SearchHit>} */
  const seen = new Map();
  for (const h of hits) {
    const key = canonicalizeUrl(h.url);
    if (!seen.has(key)) seen.set(key, h);
  }
  return [...seen.values()];
}
