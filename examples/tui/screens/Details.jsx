import React from 'react';
import { Box, Text } from 'ink';
import { Key } from '../keys.js';
import { Action } from '../actions.js';
import { useKeymap } from '../useKeymap.js';
import { BACK_KEYS, LIKE_KEYS, DISLIKE_KEYS } from '../bindings.js';

const formatDate = (iso) => {
  if (!iso) return '';
  return iso.slice(0, 16).replace('T', ' ');
};

const formatPrice = (p) => {
  if (!p) return null;
  if (p.free) return 'free';
  const cur = p.currency ?? '';
  if (p.min != null && p.max != null && p.min !== p.max) return `${p.min}–${p.max} ${cur}`.trim();
  if (p.min != null) return `${p.min} ${cur}`.trim();
  if (p.max != null) return `up to ${p.max} ${cur}`.trim();
  return null;
};

const Field = ({ label, children }) => (
  <Box>
    <Box width={11}><Text dimColor>{label}</Text></Box>
    <Box flexGrow={1}><Text>{children}</Text></Box>
  </Box>
);

export default function DetailsScreen({ event, mark, onToggleLike, onToggleDislike, onBack }) {
  const canToggle = Boolean(onToggleLike);
  useKeymap(
    [
      { keys: [...BACK_KEYS, Key.LEFT, Key.RETURN], action: Action.BACK },
      { keys: LIKE_KEYS,    action: Action.TOGGLE_LIKE,    when: canToggle },
      { keys: DISLIKE_KEYS, action: Action.TOGGLE_DISLIKE, when: canToggle },
    ],
    {
      [Action.BACK]: onBack,
      [Action.TOGGLE_LIKE]: () => onToggleLike?.(),
      [Action.TOGGLE_DISLIKE]: () => onToggleDislike?.(),
    },
  );

  if (!event) {
    return (
      <Box flexDirection="column">
        <Text>(no event selected)</Text>
        <Text dimColor>press enter/esc to go back</Text>
      </Box>
    );
  }

  const date = formatDate(event.startsAt);
  const endDate = formatDate(event.endsAt);
  const when = endDate && endDate !== date ? `${date} → ${endDate}` : date;
  const venue = event.venue ?? {};
  const venueLine = [venue.name, venue.address, venue.city, venue.country].filter(Boolean).join(', ');
  const price = formatPrice(event.price);
  const sym = mark === 'like' ? '♥' : mark === 'dislike' ? '✕' : ' ';
  const symColor = mark === 'like' ? 'green' : mark === 'dislike' ? 'red' : undefined;

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={symColor}>{sym} </Text>
        <Text bold>{event.title}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {when && <Field label="when">{when}</Field>}
        {venueLine && <Field label="where">{venueLine}</Field>}
        {price && <Field label="price">{price}</Field>}
        {event.source?.url && <Field label="source">{event.source.name ? `${event.source.name} — ${event.source.url}` : event.source.url}</Field>}
        {event.rationale && <Field label="why">{event.rationale}</Field>}
      </Box>
      {event.description && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>description</Text>
          <Text>{event.description}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>{canToggle ? '[l] like · [d] dislike · ' : ''}enter/esc/←/b/⌫ back</Text>
      </Box>
    </Box>
  );
}
