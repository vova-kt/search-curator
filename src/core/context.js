/**
 * Single factory for building a Ctx. Used by createCurator, eval scripts,
 * and tests. See docs/architecture.md.
 */

import { DEFAULTS, mergeConfig } from './config.js';
import { createLogger } from './logger.js';
import { byId, fuzzyTitle } from '../strategies/dedupe/index.js';
import { byDate, rules } from '../strategies/rank/index.js';
import { llmExpand, templates } from '../strategies/queryExpansion/index.js';

/**
 * @param {{
 *   llm: import('./types.js').LLMAdapter,
 *   search: import('./types.js').SearchAdapter[],
 *   storage: import('./types.js').StorageAdapter,
 *   strategies?: Partial<import('./types.js').Strategies>,
 *   config?: Partial<import('./types.js').Config>,
 * }} opts
 * @returns {import('./types.js').Ctx}
 */
export function createContext(opts) {
  const config = mergeConfig(DEFAULTS, opts.config);
  const logger = createLogger(config.logging.level, config.logging.file);
  const strategies = {
    queryExpansion: opts.strategies?.queryExpansion ?? [llmExpand(), templates()],
    dedupe: opts.strategies?.dedupe ?? [byId, fuzzyTitle(config.dedupe.fuzzyTitleThreshold)],
    rank: opts.strategies?.rank ?? [rules, byDate],
  };
  return { llm: opts.llm, search: opts.search, storage: opts.storage, strategies, config, logger };
}
