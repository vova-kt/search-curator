import { useInput } from 'ink';

/**
 * @typedef {Object} Binding
 * @property {Array<{ match: (input: string, key: object) => boolean }>} keys
 *   Key descriptors built from [keys.js](keys.js) — one or more keys that
 *   trigger this binding.
 * @property {string} action
 *   An [Action](actions.js) constant; used to look up the handler.
 * @property {boolean} [when]
 *   Optional gate — if explicitly `false`, the binding is skipped. Omit
 *   for unconditional bindings. Evaluate per-render in the screen so it
 *   reflects current props/state (e.g. `when: mode === 'menu'`).
 */

/**
 * Generic key dispatcher. Replaces the per-screen `useInput` switch ladder
 * with a declarative `[{ keys, action, when? }]` table plus a
 * `{ [action]: handler }` map.
 *
 * Bindings are scanned in order on each keystroke; the first match whose
 * `when` is not `false` fires its handler and stops. Put more-specific
 * bindings first when keys overlap.
 *
 * @param {Binding[]} bindings
 * @param {Record<string, () => void>} handlers
 */
export function useKeymap(bindings, handlers) {
  useInput((input, key) => {
    for (const b of bindings) {
      if (b.when === false) continue;
      if (b.keys.some((k) => k.match(input, key))) {
        const handler = handlers[b.action];
        if (handler) handler();
        return;
      }
    }
  });
}
