/**
 * Semantic verbs that TUI screens dispatch on. Decoupled from key bindings
 * so multiple keys can map to one action (e.g. `BACK` ← esc/q/b/backspace)
 * and so handlers don't need to know which key fired them.
 *
 * Per CLAUDE.md rule #4 this is the single source of truth — screens
 * import `Action.X`, never inline string literals like `'back'`.
 *
 * Naming guideline: verb-first, screen-agnostic. Distinct screens that
 * happen to share a key but mean different things should have distinct
 * entries (e.g. `QUIT` for the home screen vs. `BACK` for sub-screens).
 */
export const Action = Object.freeze({
  // Generic navigation / dismissal
  BACK:            'back',            // pop one screen / return to parent
  QUIT:            'quit',            // exit the app (top-level only)
  CANCEL:          'cancel',          // abandon a form without saving

  // List movement (Results, History, SavedQueries)
  MOVE_UP:         'moveUp',
  MOVE_DOWN:       'moveDown',
  PAGE_UP:         'pageUp',
  PAGE_DOWN:       'pageDown',
  JUMP_TOP:        'jumpTop',
  JUMP_BOTTOM:     'jumpBottom',

  // Item-level actions on the focused row
  OPEN_DETAILS:    'openDetails',
  TOGGLE_LIKE:     'toggleLike',
  TOGGLE_DISLIKE:  'toggleDislike',

  // Saved-queries list
  RUN_SELECTED:    'runSelected',
  EDIT_SELECTED:   'editSelected',
  NEW_QUERY:       'newQuery',
  DELETE_SELECTED: 'deleteSelected',
  ARCHIVE_SELECTED:'archiveSelected',
  OPEN_HISTORY:    'openHistory',
  OPEN_KEYS:       'openKeys',

  // Yes/no confirmation prompts
  CONFIRM_YES:     'confirmYes',
  CONFIRM_NO:      'confirmNo',

  // Editor menu
  SAVE:            'save',
  SAVE_AND_RUN:    'saveAndRun',
  ENTER_FORM:      'enterForm',

  // Results — feedback submission
  SUBMIT_FEEDBACK: 'submitFeedback', // record current likes/dislikes
  SKIP_FEEDBACK:   'skipFeedback',   // leave with empty feedback (esc/q/b/⌫)
});
