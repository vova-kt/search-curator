import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import { Key } from './keys.js';
import { Action } from './actions.js';
import { useKeymap } from './useKeymap.js';

/**
 * Inline prompt shown after the user toggles dislike on. Captures an optional
 * free-text reason that flows into the persisted Preference and the LLM
 * ranker. Enter commits (empty string is fine — the dislike still records).
 * Esc cancels the whole dislike action so no mark is recorded.
 *
 * Other keymap bindings on the parent screen must be gated `when: !active` so
 * raw characters don't fight TextInput while the user is typing.
 */
export default function DislikeReasonInput({ onCommit, onCancel }) {
  const [value, setValue] = useState('');
  useKeymap(
    [{ keys: [Key.ESC], action: Action.CANCEL }],
    { [Action.CANCEL]: onCancel },
  );
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text dimColor>dislike reason (optional · enter to save · esc to cancel):</Text>
      <TextInput value={value} onChange={setValue} onSubmit={() => onCommit(value)} />
    </Box>
  );
}
