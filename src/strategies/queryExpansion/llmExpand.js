/**
 * LLM-driven query expansion. One call covers timeframe phrasings, local-language variants,
 * and synonym diversity. Persisted via the storage KV table, keyed by (city, queryText, timeframe).
 *
 * Failure mode: in `config.dev` mode, the underlying error is re-thrown so misconfigurations
 * are loud during development. In prod (default), it logs a warning and falls back to the
 * `templates` strategy so a transient LLM hiccup doesn't reduce discovery to zero queries.
 */

import { expandQueriesPrompt } from '../../prompts/expandQueries.js';
import { resolveTimeframe } from '../../core/timeframe.js';
import { templates } from './templates.js';

const CACHE_PREFIX = 'qx:llmExpand:v2';

/**
 * @param {{ limit?: number }} [opts]
 * @returns {import('../../core/types.js').QueryExpansionStrategy}
 */
export function llmExpand({ limit } = {}) {
  return async function llmExpandStrategy(ctx) {
    const cap = limit ?? ctx.config.queryExpansion.defaultLimit;
    const tf = resolveTimeframe(ctx.query.timeframe, ctx.config.pipeline.defaultRollingDays);
    const key = cacheKey(ctx.query.city, ctx.query.queryText, tf);

    const cached = await ctx.storage.getKV(key);
    if (cached) {
      const parsed = safeParseQueries(cached);
      if (parsed) return parsed.slice(0, cap);
      // A bad cache row shouldn't block — fall through to a fresh LLM call.
    }

    try {
      const prompt = expandQueriesPrompt({
        city: ctx.query.city,
        queryText: ctx.query.queryText,
        timeframe: tf,
        limit: cap,
      });
      const resp = await ctx.llm.chat({
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        json: true,
        temperature: ctx.config.queryExpansion.temperature,
        maxTokens: ctx.config.queryExpansion.maxTokens,
        signal: ctx.signal,
      });
      const json = /** @type {{ queries?: unknown }} */ (resp.json ?? {});
      const queries = sanitize(json.queries);
      if (queries.length === 0) {
        throw new Error('LLM returned no usable queries');
      }
      const sliced = queries.slice(0, cap);
      await ctx.storage.setKV(key, JSON.stringify(sliced));
      return sliced;
    } catch (err) {
      if (ctx.config.dev) throw err;
      ctx.logger.warn('[llmExpand] LLM failed, falling back to templates:', err instanceof Error ? err.message : err);
      return await templates()(ctx);
    }
  };
}

/**
 * @param {string} city
 * @param {string} queryText
 * @param {{ from: string, to: string }} tf
 */
function cacheKey(city, queryText, tf) {
  return `${CACHE_PREFIX}|${normalize(city)}|${normalize(queryText)}|${tf.from}|${tf.to}`;
}

/** @param {string} s */
function normalize(s) {
  return s.trim().toLowerCase();
}

/** @param {string} raw */
function safeParseQueries(raw) {
  try {
    const parsed = JSON.parse(raw);
    return sanitize(parsed);
  } catch {
    return null;
  }
}

/**
 * @param {unknown} v
 * @returns {string[]}
 */
function sanitize(v) {
  if (!Array.isArray(v)) return [];
  /** @type {string[]} */
  const out = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}
