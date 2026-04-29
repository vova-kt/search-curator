/**
 * Progress enums for pipeline events. See docs/pipeline.md.
 */

/** @enum {string} */
export const ProgressStage = Object.freeze({
  QUERIES: 'queries',
  SEARCH:  'search',
  EXTRACT: 'extract',
  DEDUPE:  'dedupe',
  FILTER:  'filter',
  RANK:    'rank',
  PERSIST: 'persist',
});

/** @enum {string} */
export const ProgressPhase = Object.freeze({
  START: 'start',
  TICK:  'tick',
  DONE:  'done',
});

/** Display order of stages in UIs. */
export const PROGRESS_STAGE_ORDER = Object.freeze([
  ProgressStage.QUERIES,
  ProgressStage.SEARCH,
  ProgressStage.EXTRACT,
  ProgressStage.DEDUPE,
  ProgressStage.FILTER,
  ProgressStage.RANK,
  ProgressStage.PERSIST,
]);
