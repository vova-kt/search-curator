import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Key, char } from '../keys.js';
import { Action } from '../actions.js';
import { useKeymap } from '../useKeymap.js';
import { BACK_KEYS, LIST_UP_KEYS, LIST_DOWN_KEYS } from '../bindings.js';

/**
 * @param {string | undefined} iso
 */
function relativeTime(iso) {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'never';
  const now = Date.now();
  const sec = Math.max(1, Math.round((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return iso.slice(0, 10);
}

/**
 * List of saved searches with last-search relative time.
 *
 * Bindings live in the keymap below; the help footer mirrors them.
 */
export default function SavedQueriesScreen({ queries, onRun, onEdit, onNew, onDelete, onArchive, onHistory, onEditKeys, onQuit }) {
  const [cursor, setCursor] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(/** @type {null | { city: string, queryText: string }} */ (null));

  const safeCursor = Math.min(cursor, Math.max(0, queries.length - 1));
  const selected = queries[safeCursor];
  const hasQueries = queries.length > 0;
  const inConfirm = confirmDelete !== null;

  useKeymap(
    [
      // Confirm-delete prompt — gated by `inConfirm` so confirm answers
      // don't bleed into normal navigation when the prompt isn't open.
      // 'q' is omitted from the cancel set here because the screen owns 'q'
      // as QUIT in normal mode; under the prompt, BACK_KEYS' esc/⌫/b cover
      // the dismiss case.
      { keys: [char('y'), char('Y')],                            action: Action.CONFIRM_YES, when: inConfirm },
      { keys: [char('n'), char('N'), Key.ESC, Key.BACKSPACE, char('b')], action: Action.CONFIRM_NO, when: inConfirm },

      // Normal mode. `when: !inConfirm` everywhere keeps verbs from firing
      // under the prompt.
      { keys: LIST_UP_KEYS,   action: Action.MOVE_UP,         when: !inConfirm },
      { keys: LIST_DOWN_KEYS, action: Action.MOVE_DOWN,       when: !inConfirm },
      { keys: [char('n')],    action: Action.NEW_QUERY,       when: !inConfirm },
      { keys: [Key.RETURN],   action: Action.RUN_SELECTED,    when: !inConfirm && hasQueries },
      { keys: [char('e')],    action: Action.EDIT_SELECTED,   when: !inConfirm && hasQueries },
      { keys: [char('d')],    action: Action.DELETE_SELECTED, when: !inConfirm && hasQueries },
      { keys: [char('a')],    action: Action.ARCHIVE_SELECTED, when: !inConfirm && hasQueries && Boolean(onArchive) },
      { keys: [char('h')],    action: Action.OPEN_HISTORY,    when: !inConfirm && hasQueries },
      { keys: [char('K')],    action: Action.OPEN_KEYS,       when: !inConfirm && Boolean(onEditKeys) },
      { keys: [char('q')],    action: Action.QUIT,            when: !inConfirm },
    ],
    {
      [Action.CONFIRM_YES]:    () => { const t = confirmDelete; setConfirmDelete(null); onDelete(t); },
      [Action.CONFIRM_NO]:     () => setConfirmDelete(null),
      [Action.MOVE_UP]:        () => setCursor((c) => Math.max(0, c - 1)),
      [Action.MOVE_DOWN]:      () => setCursor((c) => Math.min(queries.length - 1, c + 1)),
      [Action.NEW_QUERY]:      onNew,
      [Action.RUN_SELECTED]:   () => { if (selected) onRun(selected); },
      [Action.EDIT_SELECTED]:  () => { if (selected) onEdit(selected); },
      [Action.DELETE_SELECTED]:() => { if (selected) setConfirmDelete({ city: selected.city, queryText: selected.queryText }); },
      [Action.ARCHIVE_SELECTED]:() => { if (selected && onArchive) onArchive(selected); },
      [Action.OPEN_HISTORY]:   () => { if (selected && onHistory) onHistory(selected); },
      [Action.OPEN_KEYS]:      () => onEditKeys?.(),
      [Action.QUIT]:           onQuit,
    },
  );

  if (queries.length === 0) {
    return (
      <Box flexDirection="column">
        <Text bold>saved searches</Text>
        <Box marginTop={1}><Text dimColor>(none yet)</Text></Box>
        <Box marginTop={1}>
          <Text dimColor>[n] new{onEditKeys ? ' · [K] keys' : ''} · [q] quit</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>saved searches ({queries.length})</Text>
      <Box flexDirection="column" marginTop={1}>
        {queries.map((q, i) => {
          const focused = i === safeCursor;
          return (
            <Box key={`${q.city}|${q.queryText}`}>
              <Text color={focused ? 'cyan' : undefined}>{focused ? '› ' : '  '}</Text>
              <Box width={18}><Text>{q.city}</Text></Box>
              <Box width={28}><Text>{q.queryText}</Text></Box>
              <Box width={8}><Text dimColor>{q.days}d</Text></Box>
              <Box width={8}><Text dimColor>×{q.limit}</Text></Box>
              <Text dimColor>last: {relativeTime(q.lastSearchedAt)}</Text>
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        {confirmDelete ? (
          <Text color="yellow">
            delete {confirmDelete.city} / {confirmDelete.queryText}? [y/N]
          </Text>
        ) : (
          <Text dimColor>
            ↑/↓ move · enter run · [e] edit · [n] new · [d] delete{onArchive ? ' · [a] archive' : ''} · [h] history{onEditKeys ? ' · [K] keys' : ''} · [q] quit
          </Text>
        )}
      </Box>
    </Box>
  );
}
