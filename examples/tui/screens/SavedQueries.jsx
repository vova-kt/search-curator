import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

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
 * Keys:
 *   ↑/↓ or j/k — move
 *   enter      — run selected
 *   e          — edit selected
 *   n          — create new
 *   d          — delete (asks for confirm)
 *   k          — keys screen (if available)
 *   q          — quit
 */
export default function SavedQueriesScreen({ queries, onRun, onEdit, onNew, onDelete, onEditKeys, onQuit }) {
  const [cursor, setCursor] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(/** @type {null | { city: string, category: string }} */ (null));

  const safeCursor = Math.min(cursor, Math.max(0, queries.length - 1));
  const selected = queries[safeCursor];

  useInput((input, key) => {
    if (confirmDelete) {
      if (input === 'y' || input === 'Y') {
        const target = confirmDelete;
        setConfirmDelete(null);
        onDelete(target);
      } else if (input === 'n' || input === 'N' || key.escape) {
        setConfirmDelete(null);
      }
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(queries.length - 1, c + 1));
    } else if (input === 'n') {
      onNew();
    } else if (queries.length > 0 && key.return) {
      if (selected) onRun(selected);
    } else if (queries.length > 0 && input === 'e') {
      if (selected) onEdit(selected);
    } else if (queries.length > 0 && input === 'd') {
      if (selected) setConfirmDelete({ city: selected.city, category: selected.category });
    } else if (input === 'K' && onEditKeys) {
      onEditKeys();
    } else if (input === 'q') {
      onQuit();
    }
  });

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
            <Box key={`${q.city}|${q.category}`}>
              <Text color={focused ? 'cyan' : undefined}>{focused ? '› ' : '  '}</Text>
              <Box width={18}><Text>{q.city}</Text></Box>
              <Box width={20}><Text>{q.category}</Text></Box>
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
            delete {confirmDelete.city} / {confirmDelete.category}? [y/N]
          </Text>
        ) : (
          <Text dimColor>
            ↑/↓ move · enter run · [e] edit · [n] new · [d] delete{onEditKeys ? ' · [K] keys' : ''} · [q] quit
          </Text>
        )}
      </Box>
    </Box>
  );
}
