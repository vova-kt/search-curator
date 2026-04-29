import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { Key, char } from '../keys.js';
import { Action } from '../actions.js';
import { useKeymap } from '../useKeymap.js';

/**
 * @typedef {Object} EditorValues
 * @property {string} queryText
 * @property {string} days
 * @property {string} city
 * @property {string} limit
 * @property {string} excludeKeywords    // comma-separated
 * @property {string} guidance           // free text — combined filter + rank
 */

const FIELDS = /** @type {const} */ ([
  { key: 'queryText',        label: 'query' },
  { key: 'days',             label: 'days',  numeric: true },
  { key: 'city',             label: 'city' },
  { key: 'limit',            label: 'limit', numeric: true },
  { key: 'excludeKeywords',  label: 'exclude (comma-sep)' },
  { key: 'guidance',         label: 'filter & rank prefs' },
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
 * `r` saves and runs. `c`/`b`/`backspace` cancels back to the list.
 */
export default function QueryEditorScreen({ existing, onSave, onSaveAndRun, onCancel }) {
  const [values, setValues] = useState(/** @type {EditorValues} */ ({
    queryText: existing?.queryText ?? '',
    days: String(existing?.days ?? 14),
    city: existing?.city ?? '',
    limit: String(existing?.limit ?? 10),
    excludeKeywords: csv(existing?.excludeKeywords ?? []),
    guidance: existing?.guidance ?? '',
  }));
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState(/** @type {'form'|'menu'} */ ('form'));

  const buildSavedQuery = () => ({
    city: values.city.trim(),
    queryText: values.queryText.trim(),
    days: Number(values.days) || 14,
    limit: Number(values.limit) || 10,
    excludeKeywords: fromCsv(values.excludeKeywords),
    guidance: values.guidance.trim() || undefined,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    lastSearchedAt: existing?.lastSearchedAt,
  });

  const valid = values.city.trim().length > 0 && values.queryText.trim().length > 0;
  const inMenu = mode === 'menu';

  // Esc cancels in any mode. The other cancel keys (b/⌫/c) and the menu
  // verbs are gated to menu mode so they don't fight TextInput while typing.
  useKeymap(
    [
      { keys: [Key.ESC],                                  action: Action.CANCEL },
      { keys: [Key.BACKSPACE, char('b'), char('c')],      action: Action.CANCEL,       when: inMenu },
      { keys: [char('s')],                                action: Action.SAVE,         when: inMenu && valid },
      { keys: [char('r')],                                action: Action.SAVE_AND_RUN, when: inMenu && valid },
      { keys: [char('e')],                                action: Action.ENTER_FORM,   when: inMenu },
    ],
    {
      [Action.CANCEL]:       onCancel,
      [Action.SAVE]:         () => onSave(buildSavedQuery()),
      [Action.SAVE_AND_RUN]: () => onSaveAndRun(buildSavedQuery()),
      [Action.ENTER_FORM]:   () => { setMode('form'); setIdx(0); },
    },
  );

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
              ? '[s] save · [r] save+run · [e] edit · [c]/b/⌫/esc cancel'
              : '[e] edit (city + query required) · [c]/b/⌫/esc cancel'}
          </Text>
        )}
      </Box>
    </Box>
  );
}
