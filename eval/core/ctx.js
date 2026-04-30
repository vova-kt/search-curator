/**
 * Build a minimal `Ctx` for invoking pipeline stages directly from an eval
 * script. Stages only read the fields they need, so the eval ctx omits
 * `search`, `storage`, and `strategies` — none of those are used by `extract`.
 *
 * If a future eval script targets a stage that requires more (e.g. dedupe
 * needs `strategies.dedupe`), extend this builder rather than constructing
 * the ctx inline.
 */

import { openai } from '../../src/adapters/llm/openai.js';
import { mergeConfig, DEFAULTS } from '../../src/core/config.js';
import { createLogger, LogLevel } from '../../src/core/logger.js';

/**
 * Wrap an LLMAdapter so every `chat` call gets a fixed temperature unless the
 * caller already set one. Lets eval scripts pin temperature to 0 for less
 * run-to-run drift without modifying `src/`.
 *
 * @param {import('../../src/core/types.js').LLMAdapter} llm
 * @param {number} temperature
 * @returns {import('../../src/core/types.js').LLMAdapter}
 */
function withTemperature(llm, temperature) {
  return {
    name: llm.name,
    model: llm.model,
    chat: (req) => llm.chat({ ...req, temperature: req.temperature ?? temperature }),
  };
}

/**
 * @param {{
 *   query: { city: string, queryText: string, timeframe: { from: string, to: string } },
 *   model: string,
 *   apiKey: string,
 *   temperature?: number,
 *   logLevel?: string,
 * }} opts
 */
export function buildExtractCtx({ query, model, apiKey, temperature = 0, logLevel = LogLevel.WARN }) {
  const baseLlm = openai({ apiKey, model });
  const llm = withTemperature(baseLlm, temperature);
  const config = mergeConfig(DEFAULTS, { llm: { model }, logging: { level: logLevel, file: null } });
  const logger = createLogger(logLevel, null);
  return {
    llm,
    config,
    logger,
    query,
  };
}
