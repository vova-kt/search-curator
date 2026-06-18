# Architecture

## What this is

A curator for recurring web searches: it takes a saved search ("jazz in
Berlin"), runs it on the web, reconciles results against everything seen before,
and ranks what's left by what that search has learned to like. Events are the
flagship example, but nothing is event-specific — the same machinery curates
papers, jobs, or listings, so a result carries an `attributes` map whose allowed
keys are config, not a code taxonomy. The curation logic lives in one UI-agnostic object;
the Telegram bot, scheduler, Streamlit view, and eval harness are thin shells
around it.

## The shape

One pipeline, six stages, plus a feedback path:

```
expand → search → merge → dedup → store → rank
                                            ↑
                          feedback ─────────┘  (updates the preference profile)
```

The orchestrator (`pipeline/orchestrator.py`) sequences the stages; the default
wiring of concrete implementations is `pipeline/builder.py`. Each stage is a
`typing.Protocol` in its own module, so an implementation can be swapped without
touching the orchestrator. Per-stage design: [pipeline.md](pipeline.md).

## Two decisions worth knowing

**Preferences are scoped to the saved query, not the user.** One person's "jazz
in Berlin" and "trail races in the Alps" are different tastes and must learn
independently, so a `PreferenceProfile` keys on `SavedQueryId` and feedback
carries a `saved_query_id`. See [preferences.md](preferences.md).

**The DB is multi-user from day one.** One SQLite file serves many callers, every
saved query is owned by exactly one user, and the orchestrator refuses to run or
accept feedback on a query the caller doesn't own. Identity is a deliberately
minimal auth module — see [auth.md](auth.md).

## Module layering

Modules are sealed (one public door each, `__init__.py`) and layered; a layer may
import only layers below it. import-linter enforces this
(`[tool.importlinter]` in `pyproject.toml`) so the structure can't quietly tangle
— see [guardrails.md](guardrails.md).

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

`auth` sits beside `storage`, not above it: a user id is derived deterministically
from a credential, so authentication needs no storage lookup and the two never
import each other.

## Adapters and extras

The ML-backed ports share one pattern, so the stage docs don't each re-explain it.
A real adapter pulls heavy dependencies and lives behind an optional extra (`llm`,
`embed`, `store`, `bot`); it is re-exported lazily from its module's door, so
importing the module never pulls the extra in — only naming the adapter does. The
builder picks the concrete adapter from config (`build_search_backend` /
`build_llm` / `build_embedder` / `build_storage`) and **fails fast** when the chosen
backend's extra isn't installed or its key isn't set: it raises
`AdapterNotConfiguredError` (`pipeline/builder.py`) at build time with a message naming
the missing extra or key. There are no placeholder adapters — a misconfigured
deployment stops at startup, not part-way through a run.

This is pre-`1.0` — nothing is stable (see [CLAUDE.md](../CLAUDE.md)).
