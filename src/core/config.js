/**
 * Defaults and merge logic. See docs/config.md.
 */

/** @type {import('./types.js').Config} */
export const DEFAULTS = Object.freeze({
  dev: false,
  llm: {
    model: 'gpt-5.5-mini',
    temperature: 0.2,
    maxTokens: 16000,
  },
  search: {
    maxResultsPerAdapter: 20,
    timeoutMs: 15_000,
  },
  pipeline: {
    defaultLimit: 20,
    defaultRollingDays: 90,
    extractConcurrency: 4,
    extractBatchTokenCap: 10_000,
    charsPerToken: 4,
  },
  queryExpansion: {
    defaultLimit: 8,
  },
  dedupe: {
    fuzzyTitleThreshold: 0.85,
  },
  preferences: {
    deriveTraits: true,
    traitsRefreshThreshold: 5,
  },
});

/**
 * Deep-merge plain objects. Arrays and primitives are replaced, not merged.
 * @template T
 * @param {T} base
 * @param {Partial<T> | undefined} override
 * @returns {T}
 */
export function mergeConfig(base, override) {
  if (!override) return /** @type {T} */ (deepFreeze(structuredClone(base)));
  const out = structuredClone(base);
  mergeInto(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (out)), /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (override)));
  return /** @type {T} */ (deepFreeze(out));
}

/**
 * @param {Record<string, unknown>} target
 * @param {Record<string, unknown>} src
 */
function mergeInto(target, src) {
  for (const [key, value] of Object.entries(src)) {
    if (value === undefined) continue;
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      mergeInto(/** @type {Record<string, unknown>} */ (target[key]), /** @type {Record<string, unknown>} */ (value));
    } else {
      target[key] = value;
    }
  }
}

/**
 * @template T
 * @param {T} obj
 * @returns {T}
 */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  for (const v of Object.values(obj)) deepFreeze(v);
  return Object.freeze(obj);
}
