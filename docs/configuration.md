# Configuration

Config is file-first: `config.toml` at the project root, whose tables (`[llm]`,
`[dedup]`, …) map to the nested config groups. Copy `config.example.toml` to
`config.toml` and fill in secrets. Environment variables override any value, nested
with the `__` delimiter (`DEDUP__AUTO_MERGE_THRESHOLD=0.9`) — which is how compose
injects the per-service `STORAGE__DB_PATH` and how a secrets store supplies the API
key without writing it to disk.

There are **no in-code defaults**: every field must be present in `config.toml` (or
an env override), and a missing one fails validation at startup rather than falling
back to a hidden literal. That keeps the file the complete, auditable description of
how a deployment behaves. The schema is in `config.py`, the single source of truth,
so this page doesn't restate keys; `config.example.toml` is the ready-to-copy
template.

## LLM roles

Each LLM call site is a row under `[llm.roles.<role>]` — `dedup_judge`,
`rank_reranker`, `feedback_summary` — and each must define its own model,
temperature, and system prompt (every role is required), passed in per call so no
stage carries model state. The separate `[llm].model` is the model the native
web-search backend runs. What each role does: [pipeline.md](pipeline.md) and
[preferences.md](preferences.md).

## Attribute vocabulary

`[search].attributes` is where a deployment declares the domain it curates: each
sub-table is one allowed `attributes` key with a fill instruction (handed to the
search model) and a UI emoji. Editing this set — not code — points the pipeline at
papers, jobs, or listings instead of events. The rationale and how it narrows the
extraction schema live in [pipeline.md](pipeline.md).

This is unrelated to `.streamlit/config.toml`, which configures Streamlit's own
runtime — see [deployment.md](deployment.md).
