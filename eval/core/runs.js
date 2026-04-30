/**
 * Run-record I/O. A "run" captures the output of a single eval invocation
 * (extract or rank) so prompt iterations can be diffed offline.
 *
 * Files live at `eval/runs/<slug>__<ts>.json`. Gitignored — runs are local.
 * The fixed schema is intentional: load* helpers in this module are the only
 * thing that reads them, and `promote-golden.js` only needs `events`.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = resolve(HERE, '..', 'runs');

/**
 * @typedef {Object} RunRecord
 * @property {string} slug
 * @property {'extract' | 'rank'} kind
 * @property {string} timestamp
 * @property {{ provider: string, model: string, temperature?: number }} llm
 * @property {Record<string, string>} promptHashes      // {[promptName]: git sha or content hash}
 * @property {unknown} output                            // events[] for extract; ranked events[] for rank
 * @property {unknown} [report]                          // optional metric report
 */

/**
 * @param {Omit<RunRecord, 'timestamp'>} payload
 * @returns {string} path
 */
export function writeRun(payload) {
  ensureDir(RUNS_DIR);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = resolve(RUNS_DIR, `${payload.slug}__${timestamp}.json`);
  /** @type {RunRecord} */
  const record = { ...payload, timestamp };
  writeFileSync(path, JSON.stringify(record, null, 2) + '\n');
  return path;
}

/**
 * @param {string} path
 * @returns {RunRecord}
 */
export function loadRun(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * @param {string} slug
 * @returns {string[]} run file paths, newest first
 */
export function listRuns(slug) {
  if (!existsSync(RUNS_DIR)) return [];
  const prefix = `${slug}__`;
  return readdirSync(RUNS_DIR)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .sort()
    .reverse()
    .map((f) => resolve(RUNS_DIR, f));
}

/**
 * Best-effort git sha of a file. Returns 'unknown' if git isn't available
 * or the file isn't tracked. Used to label run records with the prompt
 * version they were produced against.
 *
 * @param {string} absPath
 * @returns {string}
 */
export function gitShaOf(absPath) {
  try {
    return execSync(`git log -1 --format=%H -- "${absPath}"`, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

/** @param {string} dir */
function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
