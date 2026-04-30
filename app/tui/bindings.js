import { Key, char } from './keys.js';

/**
 * Reusable key-set fragments for the keymap layer ([useKeymap.js](useKeymap.js)).
 *
 * Each export is the set of *keys* that conceptually mean the same thing
 * across multiple screens. Screens still own the action and `when` clause
 * so handlers stay near the state they touch — sharing the keys is enough
 * to keep navigation consistent. We export plain key arrays rather than
 * full `{ keys, action }` rows because the action sometimes varies (e.g.
 * Results maps the back set to `SKIP_FEEDBACK`, not `BACK`).
 *
 * Usage:
 *   { keys: BACK_KEYS,    action: Action.BACK }
 *   { keys: LIST_UP_KEYS, action: Action.MOVE_UP, when: !inConfirm }
 */

/**
 * Universal "leave this screen" keys. Pop a screen, dismiss a prompt, or
 * skip out of a list. Screens may extend this with extras (e.g. Details
 * also accepts `←` and `enter`).
 */
export const BACK_KEYS = Object.freeze([
  Key.ESC, char('q'),
]);

/**
 * Vim-flavored cursor movement, paired with the arrow keys for users who
 * prefer them. Used by Results, History, and SavedQueries.
 */
export const LIST_UP_KEYS   = Object.freeze([Key.UP,   char('k')]);
export const LIST_DOWN_KEYS = Object.freeze([Key.DOWN, char('j')]);

/**
 * Like/dislike toggles on the focused event row. Shared between Results
 * (list view) and Details (single event view) so the muscle memory carries.
 */
export const LIKE_KEYS    = Object.freeze([char('l')]);
export const DISLIKE_KEYS = Object.freeze([char('d')]);
