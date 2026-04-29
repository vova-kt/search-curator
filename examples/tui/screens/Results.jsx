import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

const PAGE_SIZE = 10;

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
    } else if (key.pageUp || input === 'b') {
      setCursor((c) => Math.max(0, c - PAGE_SIZE));
    } else if (key.pageDown || input === 'f' || input === ' ') {
      setCursor((c) => Math.min(events.length - 1, c + PAGE_SIZE));
    } else if (input === 'g') {
      setCursor(0);
    } else if (input === 'G') {
      setCursor(events.length - 1);
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

  const pageStart = Math.floor(cursor / PAGE_SIZE) * PAGE_SIZE;
  const pageEnd = Math.min(events.length, pageStart + PAGE_SIZE);
  const visible = events.slice(pageStart, pageEnd);
  const pageNum = Math.floor(pageStart / PAGE_SIZE) + 1;
  const pageCount = Math.ceil(events.length / PAGE_SIZE);

  return (
    <Box flexDirection="column">
      <Text bold>
        results ({events.length}) <Text dimColor>· page {pageNum}/{pageCount} · showing {pageStart + 1}-{pageEnd}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((e, i) => {
          const idx = pageStart + i;
          const m = marks[e.id];
          const sym = m === 'like' ? '♥' : m === 'dislike' ? '✕' : ' ';
          const color = m === 'like' ? 'green' : m === 'dislike' ? 'red' : undefined;
          const date = (e.startsAt ?? '').slice(0, 16).replace('T', ' ');
          const venue = e.venue?.name ?? '';
          return (
            <Box key={e.id ?? idx} flexDirection="column">
              <Box>
                <Text color={idx === cursor ? 'cyan' : undefined}>{idx === cursor ? '› ' : '  '}</Text>
                <Text color={color}>{sym} </Text>
                <Text>{date}  </Text>
                <Text bold>{e.title}</Text>
                {venue && <Text dimColor>  — {venue}</Text>}
              </Box>
              {e.rationale && idx === cursor && (
                <Box marginLeft={6}>
                  <Text dimColor>↳ {e.rationale}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>↑/↓ move · pgup/pgdn page · g/G top/bot · [l] like · [d] dislike · enter save · q/esc skip</Text>
      </Box>
    </Box>
  );
}
