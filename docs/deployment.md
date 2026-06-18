# Deployment

The production target is a single Intel NUC (32 GB RAM, integrated GPU) running the
stack in Docker. Two thin processes share one SQLite file. Config is covered in
[configuration.md](configuration.md); watching a run in
[observability.md](observability.md).

## The services

`docker-compose.yml` defines them, sharing a Docker volume so the view sees the
scheduler's writes (all read `STORAGE__DB_PATH=/data/events.db`):

- **server** — the headless scheduler. It wakes every `SERVER__SCHEDULER_TICK_SECONDS`,
  finds enabled saved queries with a cron, and runs the pipeline for each. Entry point
  `apps/server.py` (the `events-curator` script).
- **bot** — the Telegram scheduler-plus-chat front door (`events-curator-bot`); see
  *The Telegram bot* below.
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

## The Telegram bot

The bot (`apps/telegram`, the `events-curator-bot` script — see
[telegram.md](telegram.md)) is the chat front door and *also its own scheduler*: one
asyncio process long-polls Telegram and ticks the schedule, delivering due results to
the owner's chat. It is **an alternative to the `server`, not an addition** — both
advance `last_run_at`, so running them against the same DB double-schedules.

Compose makes the choice explicit with profiles, so the two schedulers can never run
together by accident. The `ui` service has no profile and runs in either mode:

- **Bot deployment** — `docker compose --profile bot up`. The bot schedules and
  delivers to chat; `ui` is an optional read-only viewer.
- **Headless deployment** — `docker compose --profile headless up`. The `server`
  schedules; `ui` is the only surface.

Plain `docker compose up` (no profile) starts only `ui` and schedules nothing — pick a
profile to run a scheduler. The bot needs `[telegram].token` (or `TELEGRAM__TOKEN`);
an empty token disables it.

## Streamlit runtime config

`.streamlit/config.toml` holds the console's Streamlit settings (distinct from the
app's `config.toml`). 

## Image

One `Dockerfile` builds both (the `ui` service overrides the command). It's
uv-managed and locked: dependencies install from `uv.lock` first (cached layer),
then the project. Real adapters pull heavy deps behind extras — add an extra to the
image only once you've wired that adapter (`llm`, `embed`, `store`, `bot`).

## Continuous deployment

The NUC pulls — nothing pushes to it. A home box has no inbound exposure, so
instead of a webhook or CI-over-SSH, [`scripts/deploy.sh`](../scripts/deploy.sh)
polls `origin` on a short interval and redeploys when the deploy branch moves.
It is deliberately conservative: a new commit is **gated locally before it goes
live** — the script runs `./check.sh` (the same gate as CI; see
[guardrails.md](guardrails.md)) and only a green gate reaches
`docker compose up -d --build`. This is belt-and-suspenders over the push CI in
`.github/workflows/check.yml`: it also catches a commit landed by force-push or
one whose CI hasn't finished.

The last *deployed* commit is recorded in `.deploy-state` (gitignored), not read
from `HEAD`, so a red gate or a failed `up` leaves the running stack untouched
and the next tick retries the same commit rather than skipping it. `DEPLOY_PROFILE`
selects the scheduler (`headless` or `bot`); `DEPLOY_BRANCH` overrides the branch.

Schedule it with the systemd units beside the script
([`events-curator-deploy.service`](../scripts/events-curator-deploy.service) +
[`.timer`](../scripts/events-curator-deploy.timer)) — point `WorkingDirectory`
at the checkout, then:

```sh
sudo ln -s /opt/events-curator/scripts/events-curator-deploy.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now events-curator-deploy.timer
journalctl -u events-curator-deploy.service -f   # watch deploys
```

The host's checkout is treated as read-only: the script does a detached, forced
checkout of the fetched commit (`git checkout -f --detach`), so it tracks
whatever `origin` points at even across a **force-push** (a rewound or rebased
branch) — a tracking-branch fast-forward would fail there. The untracked
`config.toml` is never touched.

## Resetting

No migrations pre-`1.0`. When the schema changes, stop the stack, delete the volume
(the `*.db` file), and start again.
