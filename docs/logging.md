# Logging

Two entry points configure the stdlib `logging` stack, for the two ways this code
runs. Both end in the same place — stage loggers named `events_curator.stage.<name>`
(the orchestrator emits milestones at `INFO`, detail at `DEBUG`) writing to stderr —
but they're reached differently, and that split is the thing worth understanding.

## Why two entry points

**Deployed apps configure logging explicitly.** Each entrypoint (`apps/server.py`,
`apps/streamlit_app/app.py`) calls `setup_logging` (`config.py`) once at startup. It is
env-driven (`LOGGING__*`, defaults in `config.py`): the scheduler honours the
configured level (default `INFO`), while the Streamlit console forces `DEBUG`
regardless — an operator poking at a single run wants the full trace. `setup_logging`
applies the handler with `force=True`, so Streamlit re-running the script on every
interaction re-applies cleanly instead of stacking duplicate handlers.

**Ad-hoc scripts get configured implicitly.** Standalone scripts (in `pipelines/`,
`evaluation/`) don't call `setup_logging`. Instead `sitecustomize.py` — which Python
imports automatically at interpreter startup, before any user code, whenever the
project root is on `PYTHONPATH` (set `PYTHONPATH=.` in `.env`) — loads `logging.ini`
via `logging.config.fileConfig`. So a bare `python some_script.py` gets sensible
logging with zero boilerplate. To change it, edit `logging.ini`, never
`sitecustomize.py`.

The paths are independent: `setup_logging` rebuilds the root config from `AppConfig`
and does not read `logging.ini`, so an app entrypoint never inherits the file-based
config. Pick the path that matches how the code is launched.

Both paths agree on one thing: noisy third-party loggers (`NoisyLogger` in
`enums.py` — currently `httpx`, `asyncio`) are pinned to `WARNING` so their per-request
and selector chatter doesn't follow the baseline down to `DEBUG`. `setup_logging`
applies this in code after `basicConfig`; `logging.ini` does it with per-logger
sections.

## Tuning a single logger

The point of per-stage loggers is that one noisy stage can be dialed up or down
without moving the global baseline. How you do it depends on the path:

- **`logging.ini` path** — add a `[logger_<key>]` section. `logging.ini` carries a
  commented, copy-pasteable template (and a live example: `httpx` pinned to
  `WARNING`).
- **`setup_logging` path** — at runtime, any time after startup:
  `logging.getLogger("events_curator.stage.dedup").setLevel(logging.DEBUG)`.

## Not to be confused with Streamlit's logger

`.streamlit/config.toml`'s `[logger]` governs only Streamlit's *internal* logs (its
server, file watcher, script runner) — not the application's. The pipeline logs
through the stack described above, independently; changing one never affects the
other.
