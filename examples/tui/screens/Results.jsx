import React, { useEffect, useRef } from 'react';
import { Box, Text } from 'ink';
import { Key, char } from '../keys.js';
import { Action } from '../actions.js';
import { useKeymap } from '../useKeymap.js';
import { BACK_KEYS, LIST_UP_KEYS, LIST_DOWN_KEYS, LIKE_KEYS, DISLIKE_KEYS } from '../bindings.js';

const PAGE_SIZE = 10;

const Mode = Object.freeze({
  CURATED: 'curated',
  HISTORY: 'history',
});

export { Mode };

export default function ResultsScreen({
  events,
  cursor,
  setCursor,
  marks,
  setMarks,
  onSubmit,
  onBack,
  onOpenDetails,
  mode = Mode.CURATED,
  onPageVisible,
}) {
  const isHistory = mode === Mode.HISTORY;

  // Page-rendered "shown" trigger: every time the visible page changes (and on
  // first render), report the ids on that page so the consumer can persist
  // them. Idempotent at the storage layer; only fires when the page index or
  // the event-set identity actually change, ignoring callback reference churn.
  const pageStart = events.length === 0 ? 0 : Math.floor(cursor / PAGE_SIZE) * PAGE_SIZE;
  const pageEnd = Math.min(events.length, pageStart + PAGE_SIZE);
  const onPageVisibleRef = useRef(onPageVisible);
  onPageVisibleRef.current = onPageVisible;
  useEffect(() => {
    if (isHistory) return;
    if (!onPageVisibleRef.current) return;
    if (events.length === 0) return;
    const ids = events.slice(pageStart, pageEnd).map((e) => e.id).filter(Boolean);
    if (ids.length > 0) onPageVisibleRef.current(ids);
  }, [pageStart, events, isHistory]);

  const hasEvents = events.length > 0;

  useKeymap(
    hasEvents
      ? [
          { keys: LIST_UP_KEYS,                           action: Action.MOVE_UP },
          { keys: LIST_DOWN_KEYS,                         action: Action.MOVE_DOWN },
          { keys: [Key.PAGE_UP],                          action: Action.PAGE_UP },
          { keys: [Key.PAGE_DOWN, char('f'), Key.SPACE],  action: Action.PAGE_DOWN },
          { keys: [char('g')],                            action: Action.JUMP_TOP },
          { keys: [char('G')],                            action: Action.JUMP_BOTTOM },
          { keys: LIKE_KEYS,                              action: Action.TOGGLE_LIKE,    when: !isHistory },
          { keys: DISLIKE_KEYS,                           action: Action.TOGGLE_DISLIKE, when: !isHistory },
          { keys: [Key.RIGHT, char('o')],                 action: Action.OPEN_DETAILS },
          // Enter: in curated mode commits feedback; in history it's just back.
          { keys: [Key.RETURN], action: isHistory ? Action.BACK : Action.SUBMIT_FEEDBACK },
          // Back row: in history mode pops the screen; in curated mode the
          // visible effect is the same (pop to saved-list) but it's recorded
          // as an empty-feedback skip rather than ignoring the marks silently.
          { keys: BACK_KEYS, action: isHistory ? Action.BACK : Action.SKIP_FEEDBACK },
        ]
      : [
          { keys: [Key.RETURN, ...BACK_KEYS], action: Action.BACK },
        ],
    {
      [Action.MOVE_UP]:        () => setCursor(Math.max(0, cursor - 1)),
      [Action.MOVE_DOWN]:      () => setCursor(Math.min(events.length - 1, cursor + 1)),
      [Action.PAGE_UP]:        () => setCursor(Math.max(0, cursor - PAGE_SIZE)),
      [Action.PAGE_DOWN]:      () => setCursor(Math.min(events.length - 1, cursor + PAGE_SIZE)),
      [Action.JUMP_TOP]:       () => setCursor(0),
      [Action.JUMP_BOTTOM]:    () => setCursor(events.length - 1),
      [Action.TOGGLE_LIKE]:    () => {
        const id = events[cursor].id;
        setMarks({ ...marks, [id]: marks[id] === 'like' ? undefined : 'like' });
      },
      [Action.TOGGLE_DISLIKE]: () => {
        const id = events[cursor].id;
        setMarks({ ...marks, [id]: marks[id] === 'dislike' ? undefined : 'dislike' });
      },
      [Action.OPEN_DETAILS]:   () => onOpenDetails(cursor),
      [Action.SUBMIT_FEEDBACK]: () => {
        const liked = Object.entries(marks).filter(([, v]) => v === 'like').map(([id]) => id);
        const disliked = Object.entries(marks).filter(([, v]) => v === 'dislike').map(([id]) => id);
        onSubmit({ liked, disliked });
      },
      [Action.SKIP_FEEDBACK]:  () => onSubmit({ liked: [], disliked: [] }),
      [Action.BACK]:           onBack,
    },
  );

  if (!hasEvents) {
    return (
      <Box flexDirection="column">
        <Text>{isHistory ? '(no history yet for this saved search)' : '(no events found)'}</Text>
        <Text dimColor>press enter to go back</Text>
      </Box>
    );
  }

  const visible = events.slice(pageStart, pageEnd);
  const pageNum = Math.floor(pageStart / PAGE_SIZE) + 1;
  const pageCount = Math.ceil(events.length / PAGE_SIZE);
  const titleLabel = isHistory ? 'history' : 'results';

  return (
    <Box flexDirection="column">
      <Text bold>
        {titleLabel} ({events.length}) <Text dimColor>· page {pageNum}/{pageCount} · showing {pageStart + 1}-{pageEnd}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((e, i) => {
          const idx = pageStart + i;
          const m = marks?.[e.id];
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
        <Text dimColor>
          {isHistory
            ? '↑/↓ move · pgup/pgdn page · g/G top/bot · →/o details · enter/esc/q/b/⌫ back'
            : '↑/↓ move · pgup/pgdn page · g/G top/bot · →/o details · [l] like · [d] dislike · enter save · esc/q/b/⌫ skip'}
        </Text>
      </Box>
    </Box>
  );
}
