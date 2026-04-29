/**
 * Public API. See docs/architecture.md.
 */

import { DEFAULTS, mergeConfig } from './core/config.js';
import { createLogger } from './core/logger.js';
import { runCuration } from './core/pipeline.js';
import { recordFeedback } from './stages/feedback.js';
import { byId, fuzzyTitle } from './strategies/dedupe/index.js';
import { byDate, llmRank, rules } from './strategies/rank/index.js';
import { llmExpand, templates } from './strategies/queryExpansion/index.js';

export { DEFAULTS } from './core/config.js';
export { llmRank, byDate, rules } from './strategies/rank/index.js';
export { EventState, EVENT_STATE_VALUES } from './core/eventState.js';

/**
 * @typedef {Object} CreateCuratorOptions
 * @property {import('./core/types.js').LLMAdapter} llm
 * @property {import('./core/types.js').SearchAdapter[]} search
 * @property {import('./core/types.js').StorageAdapter} storage
 * @property {Partial<import('./core/types.js').Strategies>} [strategies]
 * @property {Partial<import('./core/types.js').Config>} [config]
 */

/**
 * @typedef {Object} CurateOptions
 * @property {import('./core/types.js').ProgressListener} [onProgress]
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {Object} Curator
 * @property {(query: import('./core/types.js').Query, opts?: CurateOptions) => Promise<{ events: import('./core/types.js').Event[] }>} curate
 * @property {(ref: import('./core/types.js').SavedQueryRef, opts?: import('./core/types.js').ListShownOptions) => Promise<import('./core/types.js').Event[]>} listShown
 * @property {(input: import('./core/types.js').FeedbackInput) => Promise<void>} recordFeedback
 * @property {(opts?: import('./core/types.js').ListSavedQueriesOptions) => Promise<import('./core/types.js').SavedQuery[]>} listSavedQueries
 * @property {(ref: import('./core/types.js').SavedQueryRef) => Promise<import('./core/types.js').SavedQuery | undefined>} getSavedQuery
 * @property {(q: import('./core/types.js').SavedQuery) => Promise<import('./core/types.js').SavedQuery>} upsertSavedQuery
 * @property {(ref: import('./core/types.js').SavedQueryRef) => Promise<void>} deleteSavedQuery
 * @property {() => Promise<void>} close
 */

/**
 * @param {CreateCuratorOptions} opts
 * @returns {Promise<Curator>}
 */
export async function createCurator(opts) {
  const config = mergeConfig(DEFAULTS, opts.config);
  const logger = createLogger(config.logging.level);
  const strategies = {
    queryExpansion: opts.strategies?.queryExpansion ?? [
      llmExpand({ limit: config.queryExpansion.defaultLimit }),
      templates(),
    ],
    dedupe: opts.strategies?.dedupe ?? [byId, fuzzyTitle({ threshold: config.dedupe.fuzzyTitleThreshold })],
    rank:   opts.strategies?.rank   ?? [rules, byDate],
  };

  await opts.storage.init();

  /** @type {import('./core/types.js').Query | null} */
  let lastQuery = null;

  return {
    async curate(query, curateOpts) {
      // Auto-attach the matching saved query so strategies can read taste settings
      // (excludeKeywords, derivedTraits, etc.) without a second round-trip.
      const savedQuery = query.savedQuery
        ?? (await opts.storage.getSavedQuery({ city: query.city, queryText: query.queryText }));
      const enrichedQuery = savedQuery ? { ...query, savedQuery } : query;
      /** @type {import('./core/types.js').Ctx} */
      const ctx = {
        llm: opts.llm,
        search: opts.search,
        storage: opts.storage,
        strategies,
        config,
        query: enrichedQuery,
        onProgress: curateOpts?.onProgress,
        signal: curateOpts?.signal,
        logger,
      };
      const events = await runCuration(ctx);
      lastQuery = enrichedQuery;
      // Bump last-searched timestamp on a matching saved query, if any.
      // No-op when this query wasn't run from a saved entry.
      await opts.storage.touchSavedQuery({ city: query.city, queryText: query.queryText });
      return { events };
    },

    async listShown(ref, listOpts) {
      return opts.storage.listShown(ref, listOpts);
    },

    async recordFeedback(input) {
      const ref = input.ref ?? (lastQuery
        ? { city: lastQuery.city, queryText: lastQuery.queryText }
        : null);
      if (!ref) {
        throw new Error('recordFeedback called before any curate(); pass `ref` explicitly');
      }
      const queryForCtx = lastQuery ?? { city: ref.city, queryText: ref.queryText, timeframe: { rolling: { days: 0 } } };
      /** @type {import('./core/types.js').Ctx} */
      const ctx = {
        llm: opts.llm,
        search: opts.search,
        storage: opts.storage,
        strategies,
        config,
        query: queryForCtx,
        logger,
      };
      await recordFeedback({ ...input, ref }, ctx);
    },

    async listSavedQueries(listOpts) {
      return opts.storage.listSavedQueries(listOpts);
    },

    async getSavedQuery(ref) {
      return opts.storage.getSavedQuery(ref);
    },

    async upsertSavedQuery(q) {
      return opts.storage.upsertSavedQuery(q);
    },

    async deleteSavedQuery(ref) {
      return opts.storage.deleteSavedQuery(ref);
    },

    async close() {
      await opts.storage.close();
    },
  };
}
