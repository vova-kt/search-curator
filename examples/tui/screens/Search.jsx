import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

const FIELDS = [
  { key: 'city', label: 'city' },
  { key: 'category', label: 'category' },
  { key: 'days', label: 'days', numeric: true },
  { key: 'limit', label: 'limit', numeric: true },
];

export default function SearchScreen({ initial, dry, onSubmit, onEditKeys, onClearAll, onClearCity, onQuit }) {
  const [values, setValues] = useState({
    city: initial.city ?? '',
    category: initial.category ?? '',
    days: String(initial.days ?? 14),
    limit: String(initial.limit ?? 10),
  });
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState('form'); // 'form' | 'menu'

  useInput((input, key) => {
    if (mode !== 'menu') return;
    if (input === 'r') {
      submit();
    } else if (input === 'k' && onEditKeys) {
      onEditKeys();
    } else if (input === 'c') {
      const city = values.city.trim();
      if (city) onClearCity(city);
    } else if (input === 'C') {
      onClearAll();
    } else if (input === 'q') {
      onQuit();
    } else if (input === 'e') {
      setMode('form');
      setIdx(0);
    }
  });

  const submit = () => {
    if (!values.city.trim() || !values.category.trim()) {
      setMode('form');
      setIdx(values.city.trim() ? 1 : 0);
      return;
    }
    onSubmit({
      city: values.city.trim(),
      category: values.category.trim(),
      days: Number(values.days) || 14,
      limit: Number(values.limit) || 10,
    });
  };

  const next = () => {
    if (idx < FIELDS.length - 1) {
      setIdx(idx + 1);
    } else {
      setMode('menu');
    }
  };

  return (
    <Box flexDirection="column">
      <Text bold>search</Text>
      <Box marginTop={1} flexDirection="column">
        {FIELDS.map((f, i) => (
          <Box key={f.key}>
            <Box width={12}>
              <Text color={mode === 'form' && i === idx ? 'cyan' : undefined}>
                {mode === 'form' && i === idx ? '› ' : '  '}{f.label}
              </Text>
            </Box>
            {mode === 'form' && i === idx ? (
              <TextInput
                value={values[f.key]}
                onChange={(v) => setValues({ ...values, [f.key]: f.numeric ? v.replace(/[^0-9]/g, '') : v })}
                onSubmit={next}
              />
            ) : (
              <Text dimColor>{values[f.key] || '(empty)'}</Text>
            )}
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        {mode === 'form' ? (
          <Text dimColor>enter to advance</Text>
        ) : (
          <Text dimColor>
            [r] run · [e] edit{onEditKeys ? ' · [k] keys' : ''} · [c] clear city prefs · [C] clear all · [q] quit
          </Text>
        )}
      </Box>
    </Box>
  );
}
