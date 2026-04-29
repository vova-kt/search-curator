/**
 * Public API. See docs/architecture.md.
 */

import { DEFAULTS, mergeConfig } from './core/config.js';
import { runCuration } from './core/pipeline.js';
import { recordFeedback } from './stages/feedback.js';
import { byId, fuzzyTitle } from './strategies/dedupe/index.js';
import { rules } from './strategies/filter/index.js';
import { byDate } from './strategies/rank/index.js';
import { llmExpand, templates } from './strategies/queryExpansion/index.js';

export { DEFAULTS } from './core/config.js';

/**
 * @typedef {Object} CreateCuratorOptions
 * @property {import('./core/types.js').LLMAdapter} llm
 * @property {import('./core/types.js').SearchAdapter[]} search
 * @property {import('./core/types.js').StorageAdapter} storage
 * @property {Partial<import('./core/types.js').Strategies>} [strategies]
 * @property {Partial<import('./core/types.js').Config>} [config]
 */

/**
 * @typedef {Object} Curator
 * @property {(query: import('./core/types.js').Query) => Promise<{ events: import('./core/types.js').Event[] }>} curate
 * @property {(picks: { liked: string[], disliked: string[] }) => Promise<void>} recordFeedback
 * @property {(scope?: import('./core/types.js').PreferenceScope) => Promise<void>} clearPreferences
 * @property {() => Promise<void>} close
 */

/**
 * @param {CreateCuratorOptions} opts
 * @returns {Promise<Curator>}
 */
export async function createCurator(opts) {
  const config = mergeConfig(DEFAULTS, opts.config);
  const strategies = {
    queryExpansion: opts.strategies?.queryExpansion ?? [
      llmExpand({ limit: config.queryExpansion.defaultLimit }),
      templates(),
    ],
    dedupe: opts.strategies?.dedupe ?? [byId, fuzzyTitle({ threshold: config.dedupe.fuzzyTitleThreshold })],
    filter: opts.strategies?.filter ?? [rules],
    rank:   opts.strategies?.rank   ?? [byDate],
  };

  await opts.storage.init();

  /** @type {import('./core/types.js').Event[]} */
  let lastResults = [];
  /** @type {import('./core/types.js').Query | null} */
  let lastQuery = null;

  return {
    async curate(query) {
      const preference = await opts.storage.getPreference({ city: query.city, category: String(query.category) });
      /** @type {import('./core/types.js').Ctx} */
      const ctx = {
        llm: opts.llm,
        search: opts.search,
        storage: opts.storage,
        strategies,
        config,
        query,
        preference,
      };
      const events = await runCuration(ctx);
      lastResults = events;
      lastQuery = query;
      return { events };
    },

    async recordFeedback(picks) {
      if (!lastQuery) {
        throw new Error('recordFeedback called before any curate()');
      }
      const preference = await opts.storage.getPreference({ city: lastQuery.city, category: String(lastQuery.category) });
      /** @type {import('./core/types.js').Ctx} */
      const ctx = {
        llm: opts.llm,
        search: opts.search,
        storage: opts.storage,
        strategies,
        config,
        query: lastQuery,
        preference,
      };
      await recordFeedback(picks, lastResults, ctx);
    },

    async clearPreferences(scope) {
      await opts.storage.clearPreference(scope);
    },

    async close() {
      await opts.storage.close();
    },
  };
}
