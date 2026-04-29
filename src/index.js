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
 * @property {(ids: string[], ref: import('./core/types.js').ShownRef) => Promise<void>} markShown
 * @property {(ref: import('./core/types.js').ShownRef, opts?: import('./core/types.js').ListShownOptions) => Promise<import('./core/types.js').Event[]>} listShown
 * @property {(picks: { liked: string[], disliked: string[], reasons?: Record<string, string> }) => Promise<void>} recordFeedback
 * @property {(scope?: import('./core/types.js').PreferenceScope) => Promise<void>} clearPreferences
 * @property {() => Promise<import('./core/types.js').SavedQuery[]>} listSavedQueries
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

  /** @type {import('./core/types.js').Event[]} */
  let lastResults = [];
  /** @type {import('./core/types.js').Query | null} */
  let lastQuery = null;

  return {
    async curate(query, curateOpts) {
      const preference = await opts.storage.getPreference({ city: query.city, queryText: query.queryText });
      /** @type {import('./core/types.js').Ctx} */
      const ctx = {
        llm: opts.llm,
        search: opts.search,
        storage: opts.storage,
        strategies,
        config,
        query,
        preference,
        onProgress: curateOpts?.onProgress,
        signal: curateOpts?.signal,
        logger,
      };
      const events = await runCuration(ctx);
      lastResults = events;
      lastQuery = query;
      // Bump last-searched timestamp on a matching saved query, if any.
      // No-op when this query wasn't run from a saved entry.
      await opts.storage.touchSavedQuery({ city: query.city, queryText: query.queryText });
      return { events };
    },

    async markShown(ids, ref) {
      if (ids.length === 0) return;
      await opts.storage.markShown(ids, ref);
    },

    async listShown(ref, listOpts) {
      return opts.storage.listShown(ref, listOpts);
    },

    async recordFeedback(picks) {
      if (!lastQuery) {
        throw new Error('recordFeedback called before any curate()');
      }
      const preference = await opts.storage.getPreference({ city: lastQuery.city, queryText: lastQuery.queryText });
      /** @type {import('./core/types.js').Ctx} */
      const ctx = {
        llm: opts.llm,
        search: opts.search,
        storage: opts.storage,
        strategies,
        config,
        query: lastQuery,
        preference,
        logger,
      };
      await recordFeedback(picks, lastResults, ctx);
    },

    async clearPreferences(scope) {
      await opts.storage.clearPreference(scope);
    },

    async listSavedQueries() {
      return opts.storage.listSavedQueries();
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
