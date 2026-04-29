import React, { useEffect, useRef, useState } from 'react';
import { Box, Text } from 'ink';
import { Key, char } from '../keys.js';
import { Action } from '../actions.js';
import { useKeymap } from '../useKeymap.js';
import { BACK_KEYS, LIST_UP_KEYS, LIST_DOWN_KEYS, LIKE_KEYS, DISLIKE_KEYS } from '../bindings.js';
import DislikeReasonInput from '../DislikeReasonInput.jsx';

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
  reasons,
  setReasons,
  onSubmit,
  onBack,
  onOpenDetails,
  mode = Mode.CURATED,
  onPageVisible,
}) {
  const isHistory = mode === Mode.HISTORY;
  // When set, the dislike-reason prompt is open for this event id. All other
  // keymap bindings are gated off so TextInput owns the keystream.
  const [dislikePromptId, setDislikePromptId] = useState(/** @type {string | null} */ (null));

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
  const promptOpen = dislikePromptId !== null;

  useKeymap(
    hasEvents
      ? [
          { keys: LIST_UP_KEYS,                           action: Action.MOVE_UP,        when: !promptOpen },
          { keys: LIST_DOWN_KEYS,                         action: Action.MOVE_DOWN,      when: !promptOpen },
          { keys: [Key.PAGE_UP],                          action: Action.PAGE_UP,        when: !promptOpen },
          { keys: [Key.PAGE_DOWN, char('f'), Key.SPACE],  action: Action.PAGE_DOWN,      when: !promptOpen },
          { keys: [char('g')],                            action: Action.JUMP_TOP,       when: !promptOpen },
          { keys: [char('G')],                            action: Action.JUMP_BOTTOM,    when: !promptOpen },
          { keys: LIKE_KEYS,                              action: Action.TOGGLE_LIKE,    when: !isHistory && !promptOpen },
          { keys: DISLIKE_KEYS,                           action: Action.TOGGLE_DISLIKE, when: !isHistory && !promptOpen },
          { keys: [Key.RIGHT, char('o')],                 action: Action.OPEN_DETAILS,   when: !promptOpen },
          // Enter: in curated mode commits feedback; in history it's just back.
          { keys: [Key.RETURN], action: isHistory ? Action.BACK : Action.SUBMIT_FEEDBACK, when: !promptOpen },
          // Back row: in history mode pops the screen; in curated mode the
          // visible effect is the same (pop to saved-list) but it's recorded
          // as an empty-feedback skip rather than ignoring the marks silently.
          { keys: BACK_KEYS, action: isHistory ? Action.BACK : Action.SKIP_FEEDBACK, when: !promptOpen },
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
        if (reasons?.[id]) setReasons?.({ ...reasons, [id]: undefined });
      },
      [Action.TOGGLE_DISLIKE]: () => {
        const id = events[cursor].id;
        if (marks[id] === 'dislike') {
          // Already disliked → unmark and discard reason. Re-press 'd' on the
          // same event re-opens the prompt fresh (no stale prefill).
          setMarks({ ...marks, [id]: undefined });
          if (reasons?.[id]) setReasons?.({ ...reasons, [id]: undefined });
          return;
        }
        // Defer the actual mark+reason write until the user commits the prompt.
        setDislikePromptId(id);
      },
      [Action.OPEN_DETAILS]:   () => onOpenDetails(cursor),
      [Action.SUBMIT_FEEDBACK]: () => {
        const liked = Object.entries(marks).filter(([, v]) => v === 'like').map(([id]) => id);
        const disliked = Object.entries(marks).filter(([, v]) => v === 'dislike').map(([id]) => id);
        const submittedReasons = {};
        for (const id of disliked) {
          const r = reasons?.[id];
          if (r) submittedReasons[id] = r;
        }
        onSubmit({ liked, disliked, reasons: submittedReasons });
      },
      [Action.SKIP_FEEDBACK]:  () => onSubmit({ liked: [], disliked: [], reasons: {} }),
      [Action.BACK]:           onBack,
    },
  );

  const commitDislike = (reason) => {
    const id = dislikePromptId;
    if (!id) return;
    setMarks({ ...marks, [id]: 'dislike' });
    const trimmed = reason.trim();
    if (trimmed) setReasons?.({ ...(reasons ?? {}), [id]: trimmed });
    setDislikePromptId(null);
  };
  const cancelDislike = () => setDislikePromptId(null);

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
              {m === 'dislike' && reasons?.[e.id] && (
                <Box marginLeft={6}>
                  <Text color="red" dimColor>✕ {reasons[e.id]}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
      {promptOpen ? (
        <DislikeReasonInput onCommit={commitDislike} onCancel={cancelDislike} />
      ) : (
        <Box marginTop={1}>
          <Text dimColor>
            {isHistory
              ? '↑/↓ move · pgup/pgdn page · g/G top/bot · →/o details · enter/esc/q/b/⌫ back'
              : '↑/↓ move · pgup/pgdn page · g/G top/bot · →/o details · [l] like · [d] dislike · enter save · esc/q/b/⌫ skip'}
          </Text>
        </Box>
      )}
    </Box>
  );
}
