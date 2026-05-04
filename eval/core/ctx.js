/**
 * Build a minimal Ctx via createContext for eval scripts. Stages are called
 * directly with query as a separate param — see docs/pipeline.md.
 */

import { openai } from '../../src/adapters/llm/openai.js';
import { createContext, DEFAULTS } from '../../src/index.js';
import { mergeConfig } from '../../src/core/config.js';

/** @type {import('../../src/core/types.js').StorageAdapter} */
export const nullStorage = /** @type {any} */ ({
  init: async () => {},
  close: async () => {},
  getKV: async () => null,
  setKV: async () => {},
});

/**
 * @param {{
 *   apiKey: string,
 *   qeMaxQueries?: number,
 *   qeModel?: string,
 *   eeModel?: string,
 *   eeTemperature?: number,
 *   logLevel?: 'silent'|'error'|'warn'|'info'|'debug',
 * }} opts
 * @returns {import('../../src/core/types.js').Ctx}
 */
export function createEvalContext({
  apiKey,
  qeMaxQueries,
  qeModel,
  eeModel,
  eeTemperature,
  logLevel,
}) {
  return createContext({
    llm: openai({ apiKey }),
    storage: nullStorage,
    search: [],
    strategies: { queryExpansion: [], dedupe: [], rank: [] },
    config: mergeConfig(DEFAULTS, {
      queryExpansion: {
        ...DEFAULTS.queryExpansion,
        ...(qeMaxQueries != null ? { maxQueries: qeMaxQueries } : {}),
        ...(qeModel != null ? { model: qeModel } : {}),
      },
      eventExtraction: {
        ...DEFAULTS.eventExtraction,
        ...(eeModel != null ? { model: eeModel } : {}),
        ...(eeTemperature != null ? { temperature: eeTemperature } : {}),
      },
      logging: {
        ...DEFAULTS.logging,
        ...(logLevel != null ? { level: logLevel } : {}),
        file: null,
      },
    }),
  });
}
