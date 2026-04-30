/**
 * Persists the example TUI's API keys at ~/.config/events-curator/config.json
 * (chmod 0600). Env vars take precedence over the file.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DIR = path.join(os.homedir(), '.config', 'events-curator');
const FILE = path.join(DIR, 'config.json');

/**
 * @typedef {{ openaiApiKey?: string, tavilyApiKey?: string, openaiModel?: string, dbPath?: string }} StoredConfig
 */

/** @returns {StoredConfig} */
export function loadStored() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** @param {StoredConfig} cfg */
export function saveStored(cfg) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

/**
 * Resolve effective keys. Env wins; falls back to stored file.
 * @returns {{ openaiApiKey: string, tavilyApiKey: string, openaiModel: string, dbPath: string, source: { openai: 'env'|'file'|'missing', tavily: 'env'|'file'|'missing' } }}
 */
export function resolveKeys() {
  const stored = loadStored();
  const openaiEnv = process.env.OPENAI_API_KEY;
  const tavilyEnv = process.env.TAVILY_API_KEY;
  return {
    openaiApiKey: openaiEnv ?? stored.openaiApiKey ?? '',
    tavilyApiKey: tavilyEnv ?? stored.tavilyApiKey ?? '',
    openaiModel: process.env.OPENAI_MODEL ?? stored.openaiModel ?? 'gpt-4o-mini',
    dbPath: process.env.EVENTS_DB_PATH ?? stored.dbPath ?? './events.db',
    source: {
      openai: openaiEnv ? 'env' : stored.openaiApiKey ? 'file' : 'missing',
      tavily: tavilyEnv ? 'env' : stored.tavilyApiKey ? 'file' : 'missing',
    },
  };
}

export const configPath = FILE;
