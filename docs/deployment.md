# Deployment

The production target is a single Intel NUC (32 GB RAM, integrated GPU) running
the stack in Docker. Two thin processes share one SQLite file.

## The two services

`docker-compose.yml` defines them:

- **server** — the scheduler. It wakes every `SERVER__SCHEDULER_TICK_SECONDS`,
  finds enabled saved queries with a cron, and runs the pipeline for each. Entry
  point is `apps/server.py` (`events-curator` script). Both processes pick their
  store with `build_storage` (`pipeline/builder.py`), so they share one SQLite
  file unless `STORAGE__DB_PATH` is the `:memory:` sentinel.
- **ui** — the Streamlit app (`apps/streamlit_app/app.py`). A left-hand menu
  (`st.navigation`) switches between three sections: *Query results* (run a saved
  query, give feedback), *New query* (the create form), and a **read-only**
  *Database* window (opens SQLite `mode=ro`, never writes) for inspecting what the
  server wrote. The two writable sections are **local-only** — they load only under
  `AUTH__SCHEME=local` — but still mint a `Principal` through the `auth` module so
  the pipeline's ownership checks run unchanged. Through them an operator
  creates/saves queries, runs them, and records like/dislike feedback (Like/Dislike
  open a modal that takes an optional free-text comment); a live run
  needs the `llm`/`embed` adapters wired, otherwise it surfaces the
  unconfigured-stage message rather than failing silently.

They share a Docker volume so the view sees the server's writes. Both read
`STORAGE__DB_PATH=/data/events.db`.

## Streamlit config

`.streamlit/config.toml` holds the console's Streamlit runtime settings. Its
`[theme]` block tunes the console for density — a smaller `baseFontSize` scales
the whole UI down, with tighter radius and headings (values live in the file).
The load-bearing one is `server.fileWatcherType = "none"`: Streamlit's hot-reload
watcher introspects every imported module, and once the `embed` extra loads
`transformers` that probe trips an optional `torchvision`-dependent submodule,
spraying a harmless traceback on every rerun. The console is a deployed view, not
a live-edit surface, so the watcher is pure cost here. This is distinct from
application logging (`setup_logging` / logging.ini, see [logging.md](logging.md)) — Streamlit's own
`[logger]` only governs Streamlit's internal logs.

## Image

One `Dockerfile` builds both (the `ui` service just overrides the command). It's
uv-managed and locked: dependencies install from `uv.lock` first (cached layer),
then the project. Real adapters pull heavy deps and live behind extras — install
the extra in the image only once you've wired that adapter (`llm`, `embed`,
`store`, `bot`).

## Configuration

Config is file-first: `config.toml` at the project root, whose tables (`[llm]`,
`[dedup]`, …) map to the nested config groups. Copy `config.example.toml` to
`config.toml` and fill in secrets; compose mounts it read-only into both
containers. Environment variables still override any value, nested with the `__`
delimiter (`DEDUP__AUTO_MERGE_THRESHOLD=0.9`), which is how compose injects the
per-service `STORAGE__DB_PATH` and how CI/secrets stores supply the API key
without writing it to disk.

There are **no in-code defaults**: every field must be present in `config.toml`
(or supplied by an env override), and a missing one fails validation at startup
rather than falling back to a hidden literal. That keeps the file the complete,
auditable description of how a deployment behaves. The schema — every group and
field — is in `config.py`, the single source of truth, so this page doesn't
restate the keys; `config.example.toml` is the ready-to-copy filled-in template.

Each LLM call site is a row under `[llm.roles.<role>]` (dedup judge, rank
reranker, feedback summary), and each must define its own model, temperature, and
system prompt — every role is required. The separate `[llm].model` is the model
the native web-search backend runs. See [pipeline.md](pipeline.md) and
[preferences.md](preferences.md) for what each role does.

This app config is unrelated to `.streamlit/config.toml` (covered above), which
configures Streamlit's own runtime, not events-curator.

## Logging

Both services configure the stdlib `logging` stack at startup; level and format
are env-driven (`LOGGING__*`, defaults in `config.py`). See
[logging.md](logging.md) for the two configuration paths (`setup_logging` vs
`sitecustomize.py` + `logging.ini`), per-stage tuning, and how this differs from
Streamlit's own logger.

## Resetting

There are no migrations pre-`1.0`. When the schema changes, stop the stack,
delete the volume (the `*.db` file), and start again.
