/**
 * TUI screen names. Closed set used across App.jsx and screen modules —
 * defined once here so call sites import the enum (CLAUDE.md rule #4).
 */
export const Screen = Object.freeze({
  BOOT: 'boot',
  KEYS: 'keys',
  SAVED_LIST: 'savedList',
  EDITOR: 'editor',
  PROGRESS: 'progress',
  RESULTS: 'results',
});
