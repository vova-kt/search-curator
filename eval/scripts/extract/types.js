/**
 * Shared type definitions for the extract eval.
 */

/**
 * @typedef {{ spearman: number | null, pearson: number | null, mae: number, n: number }} CorrResult
 */

/**
 * @typedef {Object} SlugMetrics
 * @property {{ precision: number, recall: number, f1: number,
 *              tp: number, goldenCount: number, candidateCount: number }} pr
 * @property {{ n: number, date: number, venue: number }} fa
 * @property {import('../../core/metrics.js').MatchResult} match
 * @property {CorrResult} overallCorr
 * @property {CorrResult} queryIntentCorr
 */

/**
 * @typedef {Object} SlugResult
 * @property {string} slug
 * @property {import('../../../src/core/types.js').Event[]} events
 * @property {import('../../core/metrics.js').GenericEvent[] | null} golden
 * @property {number} hitCount
 * @property {number} elapsedMs
 * @property {SlugMetrics | null} metrics
 * @property {Array<{ idx: number, title: string }>} hallucination
 * @property {string | null} goldenPath
 */

/**
 * @typedef {Object} Aggregate
 * @property {number} tp
 * @property {number} goldenCount
 * @property {number} candidateCount
 * @property {number} recall
 * @property {number} precision
 * @property {number} f1
 * @property {number} dateOk
 * @property {number} venueOk
 * @property {number} matchedN
 * @property {number} dateAcc
 * @property {number} venueAcc
 * @property {number} hallucCount
 * @property {CorrResult} overallCorr
 * @property {CorrResult} queryIntentCorr
 */
