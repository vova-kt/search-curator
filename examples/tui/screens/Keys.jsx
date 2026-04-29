import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

const FIELDS = [
  { key: 'openaiApiKey', label: 'OpenAI API key', mask: true },
  { key: 'tavilyApiKey', label: 'Tavily API key', mask: true },
];

export default function KeysScreen({ initial, source, onSubmit, onCancel }) {
  const [values, setValues] = useState({
    openaiApiKey: initial.openaiApiKey ?? '',
    tavilyApiKey: initial.tavilyApiKey ?? '',
  });
  const [idx, setIdx] = useState(0);

  useInput((input, key) => {
    if (key.escape && onCancel) onCancel();
  });

  const next = () => {
    if (idx < FIELDS.length - 1) {
      setIdx(idx + 1);
    } else {
      if (values.openaiApiKey && values.tavilyApiKey) {
        onSubmit(values);
      }
    }
  };

  const field = FIELDS[idx];
  const display = (v, mask) => (mask && v ? `${'•'.repeat(Math.min(v.length, 16))}${v.length > 16 ? '…' : ''}` : v || '(empty)');

  return (
    <Box flexDirection="column">
      <Text bold>API keys</Text>
      <Text dimColor>stored at ~/.config/events-curator/config.json (chmod 600). Env vars override.</Text>
      <Box marginTop={1} flexDirection="column">
        {FIELDS.map((f, i) => (
          <Box key={f.key}>
            <Box width={20}>
              <Text color={i === idx ? 'cyan' : undefined}>
                {i === idx ? '› ' : '  '}{f.label}
              </Text>
            </Box>
            {i === idx ? (
              <TextInput
                value={values[f.key]}
                onChange={(v) => setValues({ ...values, [f.key]: v })}
                onSubmit={next}
                mask={f.mask ? '•' : undefined}
              />
            ) : (
              <Text dimColor>{display(values[f.key], f.mask)} {source && source[f.key.replace('ApiKey', '')] === 'env' ? '(from env)' : ''}</Text>
            )}
          </Box>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>enter to advance · last enter saves{onCancel ? ' · esc to cancel' : ''}</Text>
      </Box>
    </Box>
  );
}
