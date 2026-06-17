# Deployment

The production target is a single Intel NUC (32 GB RAM, integrated GPU) running
the stack in Docker. Two thin processes share one SQLite file.

## The two services

`docker-compose.yml` defines them:

- **server** — the scheduler. It wakes every `SERVER__SCHEDULER_TICK_SECONDS`,
  finds enabled saved queries with a cron, and runs the pipeline for each. Entry
  point is `apps/server.py` (`events-curator` script).
- **ui** — the Streamlit DB view (`apps/streamlit_app.py`), a **read-only**
  window onto the same database for inspecting what the server wrote. It opens
  SQLite in `mode=ro`; it never writes.

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
