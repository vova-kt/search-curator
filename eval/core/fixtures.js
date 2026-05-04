/**
 * Fixture I/O for eval pipelines. Everything goes through this module so the
 * on-disk format stays consistent across extract, rank, and any future eval.
 *
 * - `search/<slug>.search.json` — committed search snapshot, self-describing
 * - `extract/<slug>.golden.json` — committed human-curated truth
 * - `expand/<slug>.expand-golden.json` — committed expand truth
 *
 * Paths resolve relative to `eval/fixtures/`, computed from this file's
 * location so the scripts work regardless of cwd.
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(HERE, '..', 'fixtures');

/**
 * @typedef {Object} SearchFixture
 * @property {string} slug
 * @property {{ city: string, queryText: string, language?: string }} query
 * @property {{ from: string, to: string }} timeframe
 * @property {string} fetchedAt
 * @property {{ adapter: string, queries: string[] }} search
 * @property {import('../../src/core/types.js').SearchHit[]} hits
 */

/**
 * @typedef {Object} GoldenEvent
 * @property {string} title
 * @property {string} startsAt           // ISO 8601
 * @property {string} [endsAt]
 * @property {import('../../src/core/types.js').EventScore} score
 * @property {{ name: string, city: string, address?: string }} venue
 * @property {{ url: string, name?: string }} source
 * @property {{ free?: boolean, min?: number, max?: number, currency?: string }} [price]
 * @property {string} [description]
 */

/**
 * @typedef {Object} GoldenFixture
 * @property {string} slug
 * @property {GoldenEvent[]} events
 */

/**
 * @typedef {Object} ExpandInputFixture
 * @property {string} slug
 * @property {{ city: string, queryText: string }} query
 * @property {{ from: string, to: string }} timeframe
 * @property {number} [limit]
 * @property {string[]} [nativeLanguageHints]   // substrings expected to appear in some queries when the city's primary language isn't English
 */

/**
 * @typedef {Object} ExpandGoldenFixture
 * @property {string} slug
 * @property {string[]} queries
 */

/**
 * @returns {string[]} slugs for all `*.search.json` files in the fixtures dir
 */
export function listSearchSlugs() {
  const dir = resolve(FIXTURES_DIR, 'search');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.search.json'))
    .map((f) => f.replace(/\.search\.json$/, ''))
    .sort();
}

/** @param {string} slug */
export function searchFixturePath(slug) {
  return resolve(FIXTURES_DIR, 'search', `${slug}.search.json`);
}

/** @param {string} slug */
export function goldenFixturePath(slug) {
  return resolve(FIXTURES_DIR, 'extract', `${slug}.golden.json`);
}

/** @param {string} slug */
export function expandInputFixturePath(slug) {
  return resolve(FIXTURES_DIR, 'expand', `${slug}.expand-input.json`);
}

/** @param {string} slug */
export function expandGoldenFixturePath(slug) {
  return resolve(FIXTURES_DIR, 'expand', `${slug}.expand-golden.json`);
}

/**
 * @param {string} slug
 * @returns {SearchFixture}
 */
export function loadSearchFixture(slug) {
  const path = searchFixturePath(slug);
  if (!existsSync(path)) throw new Error(`search fixture not found: ${path}`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * @param {string} slug
 * @returns {GoldenFixture | null}
 */
export function loadGoldenFixture(slug) {
  const path = goldenFixturePath(slug);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * @param {SearchFixture} fixture
 * @param {{ force?: boolean }} [opts]
 */
export function writeSearchFixture(fixture, opts = {}) {
  const path = searchFixturePath(fixture.slug);
  ensureDir(dirname(path));
  if (existsSync(path) && !opts.force) {
    throw new Error(`fixture already exists: ${path}\n  pass --force to overwrite`);
  }
  writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');
  return path;
}

/**
 * @param {GoldenFixture} fixture
 */
export function writeGoldenFixture(fixture) {
  const path = goldenFixturePath(fixture.slug);
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(fixture, null, 2) + '\n');
  return path;
}

/**
 * @param {string} slug
 * @returns {ExpandGoldenFixture | null}
 */
export function loadExpandGoldenFixture(slug) {
  const path = expandGoldenFixturePath(slug);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** @param {string} dir */
function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
