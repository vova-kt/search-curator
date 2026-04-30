import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { Key, char } from '../keys.js';
import { Action } from '../actions.js';
import { useKeymap } from '../useKeymap.js';
import {DEFAULTS} from "../../../src/index.js";

/**
 * @typedef {Object} EditorValues
 * @property {string} queryText
 * @property {string} days
 * @property {string} city
 * @property {string} limit
 * @property {string} excludeKeywords    // comma-separated
 * @property {string} excludeVenues      // comma-separated
 * @property {string} priceMin           // numeric or empty
 * @property {string} priceMax           // numeric or empty
 * @property {string} priceCurrency      // ISO-ish, e.g. EUR
 * @property {string} freeOnly           // 'y' | 'n'
 * @property {string} guidance           // free text — combined filter + rank
 */

const FIELDS = /** @type {const} */ ([
  { key: 'queryText',        label: 'query' },
  { key: 'days',             label: 'days',  numeric: true },
  { key: 'city',             label: 'city' },
  { key: 'limit',            label: 'limit', numeric: true },
  { key: 'excludeKeywords',  label: 'exclude kw (comma-sep)' },
  { key: 'excludeVenues',    label: 'exclude venues (comma-sep)' },
  { key: 'priceMin',         label: 'price min', numeric: true },
  { key: 'priceMax',         label: 'price max', numeric: true },
  { key: 'priceCurrency',    label: 'price currency' },
  { key: 'freeOnly',         label: 'free only (y/n)' },
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
    days: String(existing?.days ?? DEFAULTS.pipeline.defaultRollingDays),
    city: existing?.city ?? '',
    limit: String(existing?.limit ?? DEFAULTS.pipeline.defaultLimit),
    excludeKeywords: csv(existing?.excludeKeywords ?? []),
    excludeVenues: csv(existing?.excludeVenues ?? []),
    priceMin: existing?.price?.min !== undefined ? String(existing.price.min) : '',
    priceMax: existing?.price?.max !== undefined ? String(existing.price.max) : '',
    priceCurrency: existing?.price?.currency ?? '',
    freeOnly: existing?.freeOnly ? 'y' : 'n',
    guidance: existing?.guidance ?? '',
  }));
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState(/** @type {'form'|'menu'} */ ('form'));

  const buildSavedQuery = () => {
    const min = values.priceMin === '' ? undefined : Number(values.priceMin);
    const max = values.priceMax === '' ? undefined : Number(values.priceMax);
    const currency = values.priceCurrency.trim() || undefined;
    const price = (min !== undefined || max !== undefined || currency)
      ? { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(currency ? { currency } : {}) }
      : undefined;
    return {
      city: values.city.trim(),
      queryText: values.queryText.trim(),
      days: Number(values.days) || 14,
      limit: Number(values.limit) || 10,
      excludeKeywords: fromCsv(values.excludeKeywords),
      excludeVenues: fromCsv(values.excludeVenues),
      price,
      freeOnly: values.freeOnly.trim().toLowerCase().startsWith('y'),
      guidance: values.guidance.trim() || undefined,
      derivedTraits: existing?.derivedTraits,
      archived: existing?.archived ?? false,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      lastSearchedAt: existing?.lastSearchedAt,
    };
  };

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
