import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

export default function ResultsScreen({ events, onSubmit, onBack }) {
  const [cursor, setCursor] = useState(0);
  const [marks, setMarks] = useState(/** @type {Record<string, 'like'|'dislike'>} */ ({}));

  useInput((input, key) => {
    if (events.length === 0) {
      if (key.return || input === 'q' || key.escape) onBack();
      return;
    }
    if (key.upArrow || input === 'k') {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow || input === 'j') {
      setCursor((c) => Math.min(events.length - 1, c + 1));
    } else if (input === 'l') {
      const id = events[cursor].id;
      setMarks((m) => ({ ...m, [id]: m[id] === 'like' ? undefined : 'like' }));
    } else if (input === 'd') {
      const id = events[cursor].id;
      setMarks((m) => ({ ...m, [id]: m[id] === 'dislike' ? undefined : 'dislike' }));
    } else if (key.return) {
      const liked = Object.entries(marks).filter(([, v]) => v === 'like').map(([id]) => id);
      const disliked = Object.entries(marks).filter(([, v]) => v === 'dislike').map(([id]) => id);
      onSubmit({ liked, disliked });
    } else if (key.escape || input === 'q') {
      onSubmit({ liked: [], disliked: [] });
    }
  });

  if (events.length === 0) {
    return (
      <Box flexDirection="column">
        <Text>(no events found)</Text>
        <Text dimColor>press enter to go back</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold>results ({events.length})</Text>
      <Box flexDirection="column" marginTop={1}>
        {events.map((e, i) => {
          const m = marks[e.id];
          const sym = m === 'like' ? '♥' : m === 'dislike' ? '✕' : ' ';
          const color = m === 'like' ? 'green' : m === 'dislike' ? 'red' : undefined;
          const date = (e.startsAt ?? '').slice(0, 16).replace('T', ' ');
          const venue = e.venue?.name ?? '';
          return (
            <Box key={e.id ?? i} flexDirection="column">
              <Box>
                <Text color={i === cursor ? 'cyan' : undefined}>{i === cursor ? '› ' : '  '}</Text>
                <Text color={color}>{sym} </Text>
                <Text>{date}  </Text>
                <Text bold>{e.title}</Text>
                {venue && <Text dimColor>  — {venue}</Text>}
              </Box>
              {e.rationale && i === cursor && (
                <Box marginLeft={6}>
                  <Text dimColor>↳ {e.rationale}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ move · [l] like · [d] dislike · enter save · q/esc skip</Text>
      </Box>
    </Box>
  );
}
