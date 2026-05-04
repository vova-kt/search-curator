/** @param {string} s */
export function fmtDay(s) {
  const t = Date.parse(s);
  return Number.isNaN(t) ? s : new Date(t).toISOString().slice(0, 10);
}

/** @param {number | null} r */
export function fmtCorr(r) {
  return r == null ? '—' : r.toFixed(3);
}

/**
 * @param {string} label
 * @param {number} n
 */
export function section(label, n) {
  const tag = n > 0 ? ` (${n})` : '';
  return (
    `\n── ${label}${tag} ` + '─'.repeat(Math.max(0, 78 - label.length - tag.length - 4))
  );
}
