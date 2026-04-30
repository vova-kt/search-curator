# Docs

Concept-by-concept reference. One page per topic; each readable end-to-end in a few minutes. Pages explain *why* and *how* — for *what* (fields, signatures, names), read the source. See [CLAUDE.md](../CLAUDE.md) rules 6–8 for the doc style contract.

- [architecture.md](architecture.md) — layers, module boundaries, why the pipeline is shaped this way
- [pipeline.md](pipeline.md) — stage contracts, error semantics, progress
- [adapters.md](adapters.md) — search / LLM / storage adapter contracts and how to add one
- [strategies.md](strategies.md) — pluggable queryExpansion / dedupe / rank strategies; reasoning behind the defaults
- [storage.md](storage.md) — why the data is shaped this way; backend tradeoffs
- [prompts.md](prompts.md) — prompt file shape and authoring rules (XML-tagged sections, long-input exception, model-specific notes)
- [preferences.md](preferences.md) — how user signal turns into ranking input
- [examples.md](examples.md) — running the script and CLI
- [env.md](env.md) — env-var bindings for API keys and DB path
- [eval.md](eval.md) — manual-only LLM eval pipelines for prompt iteration
- [apps/tui.md](apps/tui.md) — the TUI front-end (web app planned)
