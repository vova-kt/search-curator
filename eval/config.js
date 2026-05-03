/**
 * Eval pipeline configuration. Edit the block for the script you're running,
 * then `node --env-file=.env.dev eval/scripts/<script>.js`.
 *
 * One config object so iteration is "open file, edit values, run" — no flag
 * parsing, no shell quoting. Blocks are intentionally separate: editing one
 * never affects another in flight. API keys still come from the environment
 * (loaded via `node --env-file=.env.dev`); never put secrets here.
 */
import {DEFAULTS} from "../src/index.js";

export const config = {
  /** run-extract.js — runs extract() against <fixture>.search.json. */
  runExtract: {
    fixture: 'standup-comedy-in-russian__berlin__90d-from-2026-05-01',
    model: DEFAULTS.llm.model,
    temperature: 0,
  },

  /** run-expand.js — runs llmExpand() against <fixture>.expand-input.json. */
  runExpand: {
    fixture: 'standup-comedy-in-russian__berlin__90d-from-2026-05-01',
    model: DEFAULTS.queryExpansion.model,
  },

  /** promote-golden.js — copies a reviewed run's events to <fixture>.golden.json. */
  promoteGolden: {
    fixture: 'standup-comedy-in-russian__berlin__90d-from-2026-05-01',
    /** Absolute path to a specific run JSON, or null to pick the newest. */
    /** @type {string | null} */
    runPath: null,
  },
};
