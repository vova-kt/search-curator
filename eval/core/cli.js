/**
 * Tiny argv parser for eval scripts.
 *
 * Supports `--key value`, `--key=value`, and bare `--flag` (boolean true).
 * No external deps. Unknown flags are kept as-is on the returned object so
 * scripts can validate them themselves and print useful errors.
 */

/**
 * @param {string[]} argv  // typically process.argv.slice(2)
 * @returns {Record<string, string | boolean>}
 */
export function parseArgs(argv) {
  /** @type {Record<string, string | boolean>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith('--')) continue;
    const eq = tok.indexOf('=');
    if (eq !== -1) {
      out[tok.slice(2, eq)] = tok.slice(eq + 1);
      continue;
    }
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

/**
 * @param {Record<string, string | boolean>} args
 * @param {string} key
 * @returns {string}
 */
export function requireString(args, key) {
  const v = args[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error(`missing required --${key} <value>`);
  }
  return v;
}

/**
 * @param {Record<string, string | boolean>} args
 * @param {string} key
 * @returns {number}
 */
export function requireNumber(args, key) {
  const v = args[key];
  if (typeof v !== 'string') throw new Error(`missing required --${key} <number>`);
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${key} must be a number, got ${v}`);
  return n;
}

/**
 * @param {Record<string, string | boolean>} args
 * @param {string} key
 * @returns {boolean}
 */
export function flag(args, key) {
  return args[key] === true || args[key] === 'true';
}

/**
 * Read an env var or throw a friendly message.
 *
 * @param {string} name
 * @returns {string}
 */
export function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`env var ${name} is required for this command`);
  return v;
}
