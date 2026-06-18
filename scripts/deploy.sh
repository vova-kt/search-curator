#!/usr/bin/env bash
# Single-host continuous-deployment poller (the NUC). Polls origin for new
# commits on the deploy branch; on a change it runs the guardrail gate and,
# only if the gate is green, rebuilds and restarts the stack. Meant to run on a
# short interval from the systemd timer beside this file (or cron). It's a
# no-op when origin hasn't moved past the last deployed commit, so polling is
# cheap.
#
# Knobs (env):
#   DEPLOY_BRANCH    branch to track            (default: master)
#   DEPLOY_PROFILE   compose scheduler profile  (default: headless; or: bot)
#
# The last successfully deployed commit is recorded in .deploy-state at the repo
# root. A failed gate or a failed `compose up` leaves that file untouched, so
# the next tick retries the same commit instead of silently skipping it.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

branch="${DEPLOY_BRANCH:-master}"
profile="${DEPLOY_PROFILE:-bot}"
state_file="$repo_root/.deploy-state"

git fetch --quiet origin "$branch"
remote_rev="$(git rev-parse "origin/$branch")"
deployed_rev="$(cat "$state_file" 2>/dev/null || true)"

if [[ "$remote_rev" == "$deployed_rev" ]]; then
  exit 0
fi

echo "deploy: $branch at $remote_rev (last deployed: ${deployed_rev:-none}) — gating"
# Detached, forced checkout of the fetched commit — tolerates a force-pushed
# (rewound or rebased) origin, where a tracking-branch fast-forward would fail.
git checkout --quiet --force --detach "$remote_rev"

# Mirror CI: refresh the locked env, then run the full guardrail gate. Only a
# green gate is allowed to reach `compose up`.
uv sync
./check.sh

docker compose --profile "$profile" up -d --build
echo "$remote_rev" >"$state_file"
echo "deploy: stack up at $remote_rev (profile=$profile)"
