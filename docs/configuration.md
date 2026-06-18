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

Each LLM call site is a row under `[llm.roles.<role>]` — `domain_classifier`,
`query_expander`, `dedup_judge`, `rank_reranker`, `feedback_summary`,
`search_builder` — and each must define its own model, temperature, and system
prompt (every role is required), passed in per call so no stage carries model state.
The separate `[llm].model` is the model the native web-search backend runs. What
each role does: [pipeline.md](pipeline.md) and [preferences.md](preferences.md);
`search_builder` drives the bot's new-search dialogue ([telegram.md](telegram.md)).

## Telegram bot

`[telegram]` holds the bot's `token` (empty disables the bot) and `owner_id`, the
sole chat allowed to use it today. The bot's scheduler reuses
`[server].scheduler_tick_seconds` for its tick granularity. Rationale and the
owner-only-now/public-later design: [telegram.md](telegram.md).

## Attribute vocabulary

The set of `attributes` keys a deployment can curate is **not** config: it's a
static, typed catalog in `search/attributes.py`, grouped by domain (events, papers,
jobs, listings, …). Each key carries a fill instruction (handed to the search model)
and a UI emoji. Adding or retargeting a domain is a deliberate code edit to that
catalog, not a TOML change — by design, since the keys are a closed set the rest of
the pipeline reasons about. A saved query's domain isn't configured either: the
`domain_classifier` role picks it from the query text on first run and caches it on
`SavedQuery.domain`. The rationale and how the chosen domain narrows the extraction
schema live in [pipeline.md](pipeline.md).

This is unrelated to `.streamlit/config.toml`, which configures Streamlit's own
runtime — see [deployment.md](deployment.md).
