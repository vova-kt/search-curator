/**
 * Source of truth for all tunable runtime constants.
 *
 * Adapters and stages read from `ctx.config`, never from env vars directly.
 * Env vars are read only at entry points (examples, adapter factories).
 *
 * Override flow: `createCurator({ config })` → `mergeConfig(DEFAULTS, override)`
 * → result is deep-frozen and stored as `ctx.config`. Nothing in the pipeline
 * mutates it.
 *
 * Adding a key: add it here with a default value and a comment that explains
 * what it controls. Reference it from code as `ctx.config.<section>.<key>`.
 * Docs pages must NOT duplicate the values below — they link here instead.
 *
 * Env-var bindings (entry-point concern, not core) are documented in
 * [docs/env.md](../../docs/env.md).
 */

/** @type {import('./types.js').Config} */
export const DEFAULTS = Object.freeze({
  /**
   * Global "be loud about errors" switch. When true, strategies that have a
   * graceful fallback (currently `llmExpand`) re-throw the underlying error
   * instead of warning-and-falling-back. Production runs leave this false.
   */
  dev: false,

  /**
   * Defaults for LLM adapter calls. The adapter is pluggable; these are the
   * values handed to whichever adapter is wired in unless the caller overrides
   * them per-call. Prompts under `src/prompts/` must work across all supported
   * model families — see [docs/prompts.md](../../docs/prompts.md).
   */
  llm: {
    /** Default model id passed to the adapter (e.g. an OpenAI / Anthropic model id). */
    model: 'gpt-5.5-mini',
    /** Sampling temperature. Low by default — prompts return JSON. */
    temperature: 0.2,
    /** Max output tokens per call. Sized for the largest extract batches. */
    maxTokens: 16000,
  },

  /** Defaults applied to every configured search adapter. */
  search: {
    /** Per-adapter cap on hits returned per query. */
    maxResultsPerAdapter: 20,
    /** Per-call timeout. Adapters abort the underlying request after this. */
    timeoutMs: 15_000,
  },

  /** Pipeline-stage tuning. See [docs/pipeline.md](../../docs/pipeline.md). */
  pipeline: {
    /** Number of curated events returned when the caller doesn't set `Query.limit`. */
    defaultLimit: 20,
    /** Look-ahead window (days) used when the caller asks for "upcoming" events without an explicit timeframe. */
    defaultRollingDays: 90,
    /** Worker-pool size for the extract stage's parallel LLM calls. */
    extractConcurrency: 4,
    /** Max estimated input tokens per extract LLM call. Hits are batched up to this cap. */
    extractBatchTokenCap: 10_000,
    /** Token estimator: tokens ≈ ceil(chars / charsPerToken). */
    charsPerToken: 4,
  },

  /** Tuning for the `llmExpand` query-expansion strategy. */
  queryExpansion: {
    /** Max queries `llmExpand` returns when no per-call limit is given. */
    defaultLimit: 8,
  },

  /** Tuning for dedupe strategies. */
  dedupe: {
    /** Similarity threshold above which two titles are treated as duplicates by `fuzzyTitle`. */
    fuzzyTitleThreshold: 0.85,
  },

  /** Preference / feedback behavior. See [docs/preferences.md](../../docs/preferences.md). */
  preferences: {
    /** Whether to maintain LLM-derived trait summaries from likes/dislikes. */
    deriveTraits: true,
    /** Re-derive `derivedTraits` after this many new liked/disliked events. */
    traitsRefreshThreshold: 5,
  },

  /** Core logger configuration. */
  logging: {
    /** Log level: 'silent' | 'error' | 'warn' | 'info' | 'debug'. Gates console output. */
    level: /** @type {'warn'} */ ('debug'),
    /**
     * Optional file path. When set (Node only), every logger call additionally
     * appends a JSON Lines record `{ts, level, args}` to this file regardless
     * of `level` — the file always captures debug-level detail. Browser
     * environments silently skip file output. `null` disables file logging.
     */
    file: /** @type {string|null} */ ('./curator.log'),
  },
});

/**
 * Deep-merge plain objects. Arrays and primitives are replaced, not merged.
 * Returns a deep-frozen copy — callers cannot mutate the result.
 *
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
