/**
 * Event-state enum for the (event, saved-query) junction. See docs/preferences.md.
 */

/** @enum {string} */
export const EventState = Object.freeze({
  FOUND:    'found',
  SHOWN:    'shown',
  LIKED:    'liked',
  DISLIKED: 'disliked',
});

export const EVENT_STATE_VALUES = Object.freeze([
  EventState.FOUND,
  EventState.SHOWN,
  EventState.LIKED,
  EventState.DISLIKED,
]);
