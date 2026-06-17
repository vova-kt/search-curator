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
- **ui** — the Streamlit app (`apps/streamlit_app.py`), two tabs: a **read-only**
  *Database* window (opens SQLite `mode=ro`, never writes) for inspecting what the
  server wrote, and a *Run & feedback* console. The console is **local-only** — it
  loads only under `AUTH__SCHEME=local` — but it still mints a `Principal` through
  the `auth` module so the pipeline's ownership checks run unchanged. Through it an
  operator creates/saves queries, runs them, and records like/dislike feedback; a
  live run needs the `llm`/`embed` adapters wired, otherwise it surfaces the
  unconfigured-stage message rather than failing silently.

They share a Docker volume so the view sees the server's writes. Both read
`STORAGE__DB_PATH=/data/events.db`.

## Image

One `Dockerfile` builds both (the `ui` service just overrides the command). It's
uv-managed and locked: dependencies install from `uv.lock` first (cached layer),
then the project. Real adapters pull heavy deps and live behind extras — install
the extra in the image only once you've wired that adapter (`llm`, `embed`,
`store`, `bot`).

## Configuration

All config is environment-driven, nested with the `__` delimiter
(`DEDUP__AUTO_MERGE_THRESHOLD=0.9`). Copy `.env.example` to `.env`; compose loads
it if present. The full set of groups and defaults is in `config.py` — that file
is the single source of truth, so this page intentionally doesn't restate the
keys.

## Resetting

There are no migrations pre-`1.0`. When the schema changes, stop the stack,
delete the volume (the `*.db` file), and start again.
