# Observability

Two ways to watch a pipeline run: a **live progress stream** (what it's waiting on
right now) and **logs** (what happened, after the fact). Both centre on per-stage
loggers named `events_curator.stage.<name>`, which the orchestrator drives at
`INFO` for milestones and `DEBUG` for detail — so verbosity is tunable one stage at
a time.

## Live progress

Logs explain a run after it finishes; an operator watching a slow run (web search
reads full pages, dedup and rank may call an LLM) needs to see it move. `run()`
takes an optional `ProgressListener` (`pipeline/progress.py`) and notifies it as
each stage advances. The same milestones the loggers record are fanned out to the
listener from one place (`_Reporter` in the orchestrator), so the operator's trace
and the logs never drift apart.

Each `ProgressEvent` carries the `Stage`, a `ProgressPhase`, and a ready-to-show
`detail`. A `START` fires *before* a slow await ("Searching the web…"); a `DONE`
reports the result ("Fused into 12 candidates"). The listener is called
synchronously on the run's own task in stage order, so it must stay cheap and
non-blocking — no network, no `await`. A run with no listener (scheduler, eval)
skips emission entirely; it's purely additive and never changes what a run
computes. The Streamlit console is the reference consumer: it wraps a run in an
`st.status` panel whose label tracks the running stage.

## Logs

Two entry points configure the stdlib `logging` stack, for the two ways the code
runs; both write to stderr.

- **Deployed apps configure explicitly.** Each entrypoint (`apps/server.py`,
  `apps/streamlit_app/app.py`) calls `setup_logging` (`config.py`) once at startup.
  It's env-driven (`LOGGING__*`): the scheduler honours the configured level
  (default `INFO`), the Streamlit console forces `DEBUG` (an operator poking at one
  run wants the full trace). It applies the handler with `force=True`, so Streamlit
  re-running the script re-applies cleanly instead of stacking handlers.
- **Ad-hoc scripts get configured implicitly.** Standalone scripts don't call
  `setup_logging`; instead `sitecustomize.py` — which Python imports automatically
  at startup whenever the project root is on `PYTHONPATH` — loads `logging.ini` via
  `logging.config.fileConfig`. So a bare `python some_script.py` gets sensible
  logging with zero boilerplate. To change it, edit `logging.ini`, never
  `sitecustomize.py`.

The paths are independent: `setup_logging` rebuilds the root config from
`AppConfig` and doesn't read `logging.ini`. Both pin noisy third-party loggers
(`NoisyLogger` in `enums.py` — currently `httpx`, `asyncio`) to `WARNING` so their
chatter doesn't follow the baseline down to `DEBUG`.

**Tuning one stage** without moving the global baseline depends on the path: in the
`logging.ini` path add a `[logger_<key>]` section (the file carries a
copy-pasteable template); in the `setup_logging` path call
`logging.getLogger("events_curator.stage.dedup").setLevel(logging.DEBUG)` at
runtime.

## Not Streamlit's own logger

`.streamlit/config.toml`'s `[logger]` governs only Streamlit's *internal* logs
(server, file watcher, script runner), not the application's. The pipeline logs
through the stack above, independently; changing one never affects the other.
