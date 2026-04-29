# Prompts

All LLM prompts live as their own files under `src/prompts/`. Each file exports a single function that takes structured arguments and returns `{ system, user }`.

## Why a directory of separate files

- Easy to read and edit in isolation.
- Each prompt has its own commit history.
- Pure functions, importable in both Node and browser builds (no `fs.readFileSync`, no bundler config).
- Forces a single place to look when debugging "why did the LLM say X?".

## Shape

```js
/**
 * @param {ExtractEventsArgs} args
 * @returns {{ system: string, user: string }}
 */
export function extractEventsPrompt({ pageText, city, category, timeframe }) {
  return {
    system: 'You extract structured events from web content. Return strict JSON.',
    user: [
      `City: ${city}`,
      `Category: ${category}`,
      `Timeframe: ${timeframe.from} → ${timeframe.to}`,
      '',
      'Content:',
      pageText,
      '',
      'Return JSON: { "events": [{ id, title, startsAt, venue: {...}, ... }] }',
    ].join('\n'),
  };
}
```

Conventions:

- Prompt functions are named `<concept>Prompt`.
- All inputs are explicit parameters. No env-var reads, no module-level state.
- Output schema is described inline in the `user` portion. The LLM adapter handles JSON-mode wiring.
- Prefer concrete examples over instructions when behavior is non-obvious.

## Built-in prompts

| File                                  | Purpose                                                     |
| ------------------------------------- | ----------------------------------------------------------- |
| `src/prompts/extractEvents.js`        | Convert web content into structured `Event` objects         |
| `src/prompts/dedupeJudge.js`          | Decide whether two near-duplicate events are the same       |
| `src/prompts/filterByPreference.js`   | Drop events that don't match user's traits and history      |
| `src/prompts/rankByPreference.js`     | Reorder events by likely user interest                      |
| `src/prompts/derivePreferenceTraits.js` | Summarize liked/disliked events into a short trait string |
| `src/prompts/expandQueries.js`        | Produce diverse web-search queries for the discover stage   |

## Adding a prompt

1. Create `src/prompts/<name>.js`. Export a function returning `{ system, user }`.
2. Add a JSDoc `@typedef` for its arguments, ideally above the function.
3. Use it from a stage or strategy via `ctx.llm.chat({ ...prompt, json: true })`.
4. Add it to the table above.

## Editing a prompt

Prompts are behavior. Treat them like code: small, focused changes; consider whether an existing test catches regressions; if not, add one with a recorded LLM response or a structural assertion.
