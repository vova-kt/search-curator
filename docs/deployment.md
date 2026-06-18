# Deployment

The production target is a single Intel NUC (32 GB RAM, integrated GPU) running the
stack in Docker. Two thin processes share one SQLite file. Config is covered in
[configuration.md](configuration.md); watching a run in
[observability.md](observability.md).

## The two services

`docker-compose.yml` defines them, sharing a Docker volume so the view sees the
server's writes (both read `STORAGE__DB_PATH=/data/events.db`):

- **server** — the scheduler. It wakes every `SERVER__SCHEDULER_TICK_SECONDS`, finds
  enabled saved queries with a cron, and runs the pipeline for each. Entry point
  `apps/server.py` (the `events-curator` script).
- **ui** — the Streamlit app (`apps/streamlit_app/app.py`). A left-hand menu switches
  three sections: *Query results* (run a saved query, give feedback), *New query*
  (the create form), and a **read-only** *Database* window (opens SQLite `mode=ro`)
  for inspecting what the server wrote. The two writable sections are **local-only**
  (`AUTH__SCHEME=local`) but still mint a `Principal` through `auth` so ownership
  checks run unchanged. Feedback's Like/Dislike open a modal with an optional
  free-text comment; a live run needs the `llm`/`embed` adapters wired, otherwise
  building the pipeline fails fast with `AdapterNotConfiguredError`, naming the missing
  extra or key.

Both processes pick their store with `build_storage`, so they share one SQLite file
unless `STORAGE__DB_PATH` is the `:memory:` sentinel.

## Streamlit runtime config

`.streamlit/config.toml` holds the console's Streamlit settings (distinct from the
app's `config.toml`). 

## Image

One `Dockerfile` builds both (the `ui` service overrides the command). It's
uv-managed and locked: dependencies install from `uv.lock` first (cached layer),
then the project. Real adapters pull heavy deps behind extras — add an extra to the
image only once you've wired that adapter (`llm`, `embed`, `store`, `bot`).

## Resetting

No migrations pre-`1.0`. When the schema changes, stop the stack, delete the volume
(the `*.db` file), and start again.
