# Prompts

All LLM prompts live as their own files under [src/prompts/](../src/prompts/). Each file exports a single function that takes structured arguments and returns `{ system, user }`.

## Why a directory of separate files

- Easy to read and edit in isolation; each prompt has its own commit history.
- Pure functions, importable in both Node and browser builds (no `fs.readFileSync`, no bundler config).
- Forces a single place to look when debugging "why did the LLM say X?".

Each file is named `<concept>Prompt`; all inputs are explicit parameters (no env reads, no module-level state). The `system` portion carries the static contract (role, task, rules, input format, output format, examples). The `user` portion carries only per-call data. The LLM adapter handles JSON-mode wiring. For working examples read [src/prompts/](../src/prompts/) directly — pasted bodies in this doc would rot.

## Authoring rules

The default model id lives in [src/core/config.js](../src/core/config.js) (`llm.model`). The LLM adapter is pluggable, so prompts must work well across:

- `openai-gpt-5.5-mini` / `openai-gpt-5.5`
- `anthropic-sonnet-4.6` / `anthropic-opus-4.7`

This guide consolidates official guidance from [Anthropic's prompting best practices](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/claude-prompting-best-practices) and [OpenAI's GPT-5 prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide) into one ruleset. Read it before writing or editing a prompt.

### system vs user

- **`system`** — static contract: who the model is, what it does, the rules, the input shape, the output shape, examples. No per-call values.
- **`user`** — only the per-call input. No instructions, no role restatement, no schema reminders.

This separation is what makes prompts cacheable on the OpenAI side and lets Claude treat the system message as the authoritative role definition.

### Standard system structure

Use this section order. Wrap each in an XML tag — Claude parses XML tags substantially more reliably than prose section headers, and GPT-5 handles them fine. Don't hand-build the wrapping; use the `buildSystem` helper in [src/prompts/_system.js](../src/prompts/_system.js), which owns tag names and order — pass each section's body as a string, omit the ones you don't need.

1. `<role>` — one sentence. Frame the model as a specialist for the specific task. Don't stack adjectives ("expert, careful, meticulous") — they add tokens without lifting quality.
2. `<task>` — one or two sentences naming the concrete deliverable and its purpose.
3. `<rules>` — bullet list of conditions, edge cases, what to omit, what to copy verbatim.
4. `<input_format>` — describe the shape of the `user` message. Naming the sections is what lets `user` stay instruction-free.
5. `<output_format>` — the exact JSON shape the model must return. Use a prose schema (field names, types, optionality with `?`, nesting) — not a JSON Schema document. Place this immediately before `<examples>` (or last) so it's the freshest context before the user input.
6. `<examples>` — optional. Wrap each in its own `<example>` tag inside `<examples>`.

Two principles for the `<rules>` section in particular:

- **Tell the model what to do, not what not to do.** "Omit any event without a precise date" beats "do not include vague dates". Negative rules are fine when there's no positive equivalent.
- **State scope explicitly.** Claude Opus 4.7 follows instructions literally and will not generalize "apply this to the title" to the description. If a rule applies to every field, say so.

When to put examples first vs last:
- **Schema / structured-output tasks** (most of ours): examples last. The schema spec is the primary signal.
- **Tone / style / classification tasks** where rules are hard to articulate: examples immediately after `<task>`, before `<rules>`. The pattern in the examples *is* the spec.

Skip examples entirely when the schema and rules pin the output unambiguously.

### The user message

Per-call data only. Use labelled lines or XML tags depending on payload size:

- Small structured inputs (a handful of scalars): `Key: value` lines, mirroring `<input_format>` names.
- Larger or nested inputs (lists of events, multiple documents): XML tags matching `<input_format>`.

### Long-input exception

Anthropic documents up to a ~30% quality lift on multi-document tasks when long inputs sit *near the top of the prompt, above the query*. Apply this when a single call carries more than a few thousand tokens of variable data (e.g. `extractEvents` with full page text):

- Keep `system` instruction-only as usual.
- In `user`, place the bulk data block first, then a short trailing recap of the immediate ask (one or two lines, referencing the shape declared in `<output_format>`).

For small payloads (query expansion, dedupe judge, trait derivation) this exception does **not** apply — keep `user` as `Key: value` lines.

## Model-specific tuning notes

These are tuning hints, not separate prompts. Write one prompt that works across all four; if a model misbehaves on a specific prompt, adjust the wording in place.

### Claude Opus 4.7 / Sonnet 4.6

- Follows instructions more literally than prior Claude versions, especially at lower effort. State scope per rule.
- Strongly prefers XML-tagged structure. The standard sections above are exactly what Claude expects.
- Sonnet 4.6 defaults to `high` effort; set effort explicitly in the LLM adapter when latency matters. Prompt content is unaffected.
- Examples wrapped in `<example>` / `<examples>` tags carry more signal than prose-introduced examples.

### OpenAI GPT-5.5 / GPT-5.5-mini

- "Extraordinarily receptive to instructions" — terse, direct phrasing wins over elaborate justification.
- Markdown headers also work, but XML tags work just as well and let one prompt serve both vendors. Stay on XML.
- For `gpt-5.5-mini`, keep `<rules>` short and concrete; the smaller model degrades faster than Opus on rule-heavy prompts.

## Adding or editing a prompt

1. Create or edit `src/prompts/<name>.js` so it returns `{ system, user }`. Use `buildSystem` rather than hand-building XML.
2. Add a JSDoc `@typedef` for its arguments above the function.
3. Use it from a stage or strategy via `ctx.llm.chat({ ...prompt, json: true })`.
4. Treat prompts as behavior — small, focused changes; consider whether an existing test catches regressions; if not, add one.
5. For LLM-driven stages with non-trivial output (extract today, rank next), the [eval pipeline](eval.md) is faster than re-running the full curator.

### Checklist before merging a prompt change

- [ ] `system` follows the section order above and uses XML tags.
- [ ] `user` contains only per-call data — no instructions, no schema reminders.
- [ ] Long-input exception applied where the variable payload is large.
- [ ] Output schema described as prose in `<output_format>`.
- [ ] Rules phrased positively where possible; scope stated explicitly.
- [ ] No closed-set string literals scattered across rules — use enums per [CLAUDE.md](../CLAUDE.md) rule 4.
- [ ] `npm run typecheck` and `npm test` pass.
