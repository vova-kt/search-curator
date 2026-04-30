#!/usr/bin/env node
/**
 * Interactive TUI example. See docs/examples.md.
 *
 * Switches the terminal into the alternate screen buffer for a fullscreen feel,
 * and restores it on exit.
 */

import React from 'react';
import { render } from 'ink';
import App from './App.jsx';

const dry = process.argv.includes('--dry');

const ENTER_ALT = '\x1b[?1049h';
const LEAVE_ALT = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

let restored = false;
function restore() {
  if (restored) return;
  restored = true;
  process.stdout.write(SHOW_CURSOR + LEAVE_ALT);
}

if (process.stdout.isTTY) {
  process.stdout.write(ENTER_ALT + HIDE_CURSOR);
}

process.on('exit', restore);
process.on('SIGINT', () => { restore(); process.exit(130); });
process.on('SIGTERM', () => { restore(); process.exit(143); });

const { waitUntilExit } = render(<App dry={dry} />, { exitOnCtrlC: false });

waitUntilExit().then(restore, (err) => {
  restore();
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
