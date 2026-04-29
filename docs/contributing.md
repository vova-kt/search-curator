# Contributing

This document restates the project rules for human contributors and Claude alike. The canonical home is also `CLAUDE.md`; this page is for casual visitors.

## The three rules

### 1. Update docs and `CLAUDE.md` after each change

Whenever behavior, public API, config, prompts, or strategies change, update the matching `docs/*.md` page in the same change. Docs are the source of truth, not commit messages.

If you only changed a `CLAUDE.md` quick-orientation pointer, you only need to edit `CLAUDE.md`. If you changed the *rules*, edit both `CLAUDE.md` and this page.

### 2. Bug fixes target the root cause

Don't patch symptoms, swallow errors, or special-case the failing input. Trace failures to the underlying cause.

If the root cause is genuinely out of scope for the current change, say so explicitly in the PR / commit and stop. Don't ship a workaround silently.

### 3. No backward compatibility while in development

The lib is pre-`1.0`. Rename, restructure, drop fields, change return shapes whenever it makes the design better. No deprecation shims, no "legacy" branches, no aliases. Update the docs and move on.

## Workflow

1. Read the relevant `docs/` page.
2. Make the code change.
3. Update the matching docs page.
4. `npm run typecheck`
5. `npm test`
6. Commit.

## Adding things

- **A stage** → see [pipeline.md](pipeline.md).
- **An adapter** → see [adapters.md](adapters.md).
- **A strategy** → see [strategies.md](strategies.md).
- **A prompt** → see [prompts.md](prompts.md).
- **A config key** → see [config.md](config.md).
- **A storage column** → see [storage.md](storage.md). Edit the schema in place across all three adapters and reset local databases — no migrations.

## Tests

- `node --test` driven, files under `test/`.
- `adapters/storage/memory.js` for any test that needs storage; never hit a real SQLite file in tests.
- LLM and search calls are stubbed via fake adapters (`{ name: 'stub', chat/search: async () => ... }`).
