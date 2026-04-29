# Prompts

All LLM prompts live as their own files under `src/prompts/`. Each file exports a single function that takes structured arguments and returns `{ system, user }`.

## Why a directory of separate files

- Easy to read and edit in isolation.
- Each prompt has its own commit history.
- Pure functions, importable in both Node and browser builds (no `fs.readFileSync`, no bundler config).
- Forces a single place to look when debugging "why did the LLM say X?".

## Shape

Each prompt file exports a function `({ ...args }) => ({ system, user })`. Read the actual files under `src/prompts/` for working examples — don't reproduce them here, the duplicates rot.

Conventions:

- Prompt functions are named `<concept>Prompt`.
- All inputs are explicit parameters. No env-var reads, no module-level state.
- The `system` portion carries the static contract — role, task, rules, input format, output format, and any examples. The `user` portion carries only the per-call data (user preferences and content). The LLM adapter handles JSON-mode wiring.
- Prefer concrete examples over instructions when behavior is non-obvious.

## Authoring rules

The full structure (XML-tagged sections, ordering, the long-input exception, model-specific notes for `gpt-5.5-mini` / `gpt-5.5` / Sonnet 4.6 / Opus 4.7) lives in [prompts_guide.md](./prompts_guide.md). Read it before writing or editing a prompt.

## Built-in prompts

| File                                  | Purpose                                                     |
| ------------------------------------- | ----------------------------------------------------------- |
| `src/prompts/extractEvents.js`        | Convert web content into structured `Event` objects         |
| `src/prompts/dedupeJudge.js`          | Decide whether two near-duplicate events are the same       |
| `src/prompts/rankByPreference.js`     | Combined filter + rank: drop poor matches, order kept events by likely interest, attach a ~5-word rationale. Receives the user's original `(city, queryText)` as the on-topic filter, plus optional `guidance` for further filter+rank refinement. Disliked examples may carry an optional `reason` (user's free-text note); the prompt instructs the model to apply that principle generally rather than only to literal lookalikes. |
| `src/prompts/derivePreferenceTraits.js` | Summarize liked/disliked events into a short trait string, anchored by the saved query's `queryText` and (when set) `guidance`. Disliked examples may include a `reason`; when present it is weighted heavily as user-supplied principle. |
| `src/prompts/expandQueries.js`        | Produce diverse web-search queries for the discover stage   |

## Adding a prompt

1. Create `src/prompts/<name>.js`. Export a function returning `{ system, user }`.
2. Add a JSDoc `@typedef` for its arguments, ideally above the function.
3. Use it from a stage or strategy via `ctx.llm.chat({ ...prompt, json: true })`.
4. Add it to the table above.

## Editing a prompt

Prompts are behavior. Treat them like code: small, focused changes; consider whether an existing test catches regressions; if not, add one with a recorded LLM response or a structural assertion.
