/**
 * Key descriptors used by the keymap dispatcher ([useKeymap.js](useKeymap.js)).
 *
 * Each entry is a frozen `{ id, label, match }` object:
 *   - `id`    — stable name used for debugging/equality.
 *   - `label` — short glyph or word for help footers.
 *   - `match(input, key)` — predicate against Ink's `useInput` arguments.
 *
 * Two flavors:
 *   - **Special-key constants** on `Key.*` match the boolean flags Ink sets
 *     on its `key` argument (escape, return, arrows, page-up/down, …).
 *   - **`char(c)` factory** builds a descriptor that matches a literal
 *     character in the `input` string. Use it inline in screen bindings:
 *     `char('q')`, `char('K')`. Case-sensitive — `char('k')` ≠ `char('K')`.
 *
 * Per CLAUDE.md rule #4 the closed set of special keys is a frozen enum
 * here — screens never inline `key.escape` etc. directly.
 */

const special = (id, label, match) => Object.freeze({ id, label, match });

export const Key = Object.freeze({
  // Cancel / dismiss / back-out; sent by the Esc key on most terminals.
  ESC:        special('esc',       'esc',  (_, k) => k.escape),
  // Submit / confirm; Enter or Return.
  RETURN:     special('return',    '⏎',    (_, k) => k.return),
  // Erase / step-out; doubles as a back-navigation key in this TUI.
  BACKSPACE:  special('backspace', '⌫',    (_, k) => k.backspace),
  // Arrow keys — used for cursor movement and one-step navigation (← back).
  LEFT:       special('left',      '←',    (_, k) => k.leftArrow),
  RIGHT:      special('right',     '→',    (_, k) => k.rightArrow),
  UP:         special('up',        '↑',    (_, k) => k.upArrow),
  DOWN:       special('down',      '↓',    (_, k) => k.downArrow),
  // Page jumps over long lists.
  PAGE_UP:    special('pgup',      'pgup', (_, k) => k.pageUp),
  PAGE_DOWN:  special('pgdn',      'pgdn', (_, k) => k.pageDown),
  // Field advance in form-style screens.
  TAB:        special('tab',       'tab',  (_, k) => k.tab),
  // Spacebar — Ink reports it through `input` rather than a flag, so this
  // descriptor matches the literal " " character.
  SPACE:      special('space',     'space', (input) => input === ' '),
});

/**
 * Build a key descriptor matching a single literal character on `input`.
 * Case-sensitive; pass each casing you want to accept separately.
 */
export const char = (c) => Object.freeze({
  id: `char:${c}`,
  label: c,
  match: (input) => input === c,
});
