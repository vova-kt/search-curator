# Architecture

## What this is

A curator for recurring web searches: it takes a user's saved search ("jazz in
Berlin"), runs it on the web, reconciles the results against everything seen
before, and ranks what's left by what that particular search has learned to
like. Upcoming events are the flagship example, but nothing in the pipeline is
event-specific — the same machinery curates papers, jobs, or listings; a result
carries free-form `tags` rather than a fixed category taxonomy. The work is the
same whether it's driven by a Telegram bot, a scheduler, a Streamlit view, or the
eval harness — so the curation logic lives in one UI-agnostic object and the UIs
are thin shells around it.

## The shape

One pipeline, six stages, plus a feedback path:

```
expand → search → merge → dedup → store → rank
                                            ↑
                          feedback ─────────┘  (updates the preference profile)
```

The orchestrator that sequences them is
`src/events_curator/pipeline/orchestrator.py`; the default wiring of concrete
stage implementations is `pipeline/builder.py`. Each stage is a `typing.Protocol`
in its own module (`expand/`, `search/`, …), so an implementation can be swapped
without touching the orchestrator. See [pipeline.md](pipeline.md) for the
per-stage design.

## Two decisions worth knowing

**Preferences are scoped to the saved query, not the user.** One person's "jazz
in Berlin" and "trail races in the Alps" are different tastes and must learn
independently. So a `PreferenceProfile` keys on `SavedQueryId`, and the
orchestrator reads/writes preferences per query. This is the reason feedback
carries a `saved_query_id` rather than just a user. See
[preferences.md](preferences.md).

**The DB is multi-user from day one.** A single SQLite file serves many callers,
every saved query is owned by exactly one user, and the orchestrator refuses to
run or accept feedback on a query the caller doesn't own. Identity is handled by
a deliberately minimal auth module — see [auth.md](auth.md).

## Module layering

Modules are sealed (one public door each, `__init__.py`) and arranged in layers;
a layer may import only layers below it. The contract is machine-checked by
import-linter (see `[tool.importlinter]` in `pyproject.toml`) so the structure
can't quietly tangle as the code grows under AI iteration.

```
apps                                  (UIs: bot, scheduler, streamlit)
eval                                  (offline scoring harness)
pipeline                              (orchestrator + builder)
expand | search | merge | dedup | rank | feedback   (the stages)
storage | auth | llm | embed          (ports + adapters)
models                                (shared vocabulary)
config
enums
```

`auth` sits beside `storage` rather than above it: a principal's user id is
derived deterministically from its credential, so authentication needs no
storage lookup and the two never import each other. Why this matters mechanically
is covered in [guardrails.md](guardrails.md).

## Status

Pre-`1.0`, nothing stable (see [CLAUDE.md](../CLAUDE.md)). The skeleton runs
end-to-end with the real `IdentityExpander`, `FrontierWebSearch` engine (with its
`OpenAIWebSearch` backend behind the `llm` extra), `RRFMerger`, and
`InMemoryStorage`; `dedup`, `rank`, and `feedback` ship as stubs that raise with a
pointer to the adapter to wire next.
