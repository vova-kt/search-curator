/**
 * Stdout report rendering helpers. Generic across eval kinds; the script
 * decides which sections to show.
 *
 * Output is plain text — scannable in a terminal, copy-pastable into an issue.
 */

/** @param {string} s */
export function header(s) {
  return s;
}

/**
 * @param {string} label
 * @param {number} num
 * @param {number} denom
 * @param {string} [trailer]
 */
export function ratio(label, num, denom, trailer = '') {
  const pct = denom === 0 ? 0 : num / denom;
  return `  ${label.padEnd(28)} ${num}/${denom}  (${pct.toFixed(3)})${trailer ? '  ' + trailer : ''}`;
}

/**
 * @param {import('./metrics.js').GenericEvent[]} events
 * @param {number[]} idxs
 * @param {string} title
 */
export function eventList(title, events, idxs) {
  if (idxs.length === 0) return `${title}: none`;
  const lines = [`${title}:`];
  for (const i of idxs) {
    const e = events[i];
    lines.push(`  - "${e.title}" ${formatDay(e.startsAt)} — ${e.venue?.name ?? '?'}`);
  }
  return lines.join('\n');
}

/**
 * @param {string} s
 */
function formatDay(s) {
  const t = Date.parse(s);
  if (Number.isNaN(t)) return s;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Compose the final report from named sections. Inserts a blank line between
 * each. Missing/empty sections are filtered out.
 *
 * @param {Array<string | null | undefined>} sections
 * @returns {string}
 */
export function compose(sections) {
  return sections.filter((s) => s && s.length > 0).join('\n\n');
}
