import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

/**
 * @typedef {Object} EditorValues
 * @property {string} city
 * @property {string} category
 * @property {string} days
 * @property {string} limit
 * @property {string} excludeKeywords    // comma-separated
 * @property {string} rankGuidance       // free text
 */

const FIELDS = /** @type {const} */ ([
  { key: 'city',             label: 'city' },
  { key: 'category',         label: 'category' },
  { key: 'days',             label: 'days',  numeric: true },
  { key: 'limit',            label: 'limit', numeric: true },
  { key: 'excludeKeywords',  label: 'exclude (comma-sep)' },
  { key: 'rankGuidance',     label: 'rank guidance' },
]);

/**
 * @param {string[]} arr
 */
const csv = (arr) => (arr ?? []).join(', ');

/**
 * @param {string} s
 */
const fromCsv = (s) => s.split(',').map((x) => x.trim()).filter((x) => x.length > 0);

/**
 * Editor for a single SavedQuery.
 *
 * `existing` is the SavedQuery being edited (or null for a new one). `s` saves;
 * `r` saves and runs. `c` cancels back to the list.
 */
export default function QueryEditorScreen({ existing, onSave, onSaveAndRun, onCancel }) {
  const [values, setValues] = useState(/** @type {EditorValues} */ ({
    city: existing?.city ?? '',
    category: existing?.category ?? '',
    days: String(existing?.days ?? 14),
    limit: String(existing?.limit ?? 10),
    excludeKeywords: csv(existing?.excludeKeywords ?? []),
    rankGuidance: existing?.rankGuidance ?? '',
  }));
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState(/** @type {'form'|'menu'} */ ('form'));

  const buildSavedQuery = () => ({
    city: values.city.trim(),
    category: values.category.trim(),
    days: Number(values.days) || 14,
    limit: Number(values.limit) || 10,
    excludeKeywords: fromCsv(values.excludeKeywords),
    rankGuidance: values.rankGuidance.trim() || undefined,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    lastSearchedAt: existing?.lastSearchedAt,
  });

  const valid = values.city.trim().length > 0 && values.category.trim().length > 0;

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (mode !== 'menu') return;
    if (input === 's' && valid) {
      onSave(buildSavedQuery());
    } else if (input === 'r' && valid) {
      onSaveAndRun(buildSavedQuery());
    } else if (input === 'c') {
      onCancel();
    } else if (input === 'e') {
      setMode('form');
      setIdx(0);
    }
  });

  const next = () => {
    if (idx < FIELDS.length - 1) {
      setIdx(idx + 1);
    } else {
      setMode('menu');
    }
  };

  return (
    <Box flexDirection="column">
      <Text bold>{existing ? 'edit search' : 'new search'}</Text>
      <Box marginTop={1} flexDirection="column">
        {FIELDS.map((f, i) => {
          const focused = mode === 'form' && i === idx;
          const value = values[f.key];
          return (
            <Box key={f.key}>
              <Box width={22}>
                <Text color={focused ? 'cyan' : undefined}>
                  {focused ? '› ' : '  '}{f.label}
                </Text>
              </Box>
              {focused ? (
                <TextInput
                  value={value}
                  onChange={(v) => setValues({
                    ...values,
                    [f.key]: f.numeric ? v.replace(/[^0-9]/g, '') : v,
                  })}
                  onSubmit={next}
                />
              ) : (
                <Text dimColor>{value || '(empty)'}</Text>
              )}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        {mode === 'form' ? (
          <Text dimColor>enter to advance · esc to cancel</Text>
        ) : (
          <Text dimColor>
            {valid
              ? '[s] save · [r] save+run · [e] edit · [c] cancel'
              : '[e] edit (city + category required) · [c] cancel'}
          </Text>
        )}
      </Box>
    </Box>
  );
}
