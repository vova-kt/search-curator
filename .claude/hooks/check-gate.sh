#!/usr/bin/env bash
# Guardrail gate, run automatically when Claude finishes a turn (a Stop hook).
#
# Runs the fast checks. If they fail, exit 2 so the errors are handed back to
# Claude to fix in the same session — the operator never has to read them. The
# stop_hook_active guard means a genuinely unfixable failure surfaces to the
# human after one retry instead of looping forever. See docs/guardrails.md.
set -uo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# One-retry guard: if this Stop hook already fired once this turn, don't re-block.
if [[ "${CLAUDE_STOP_HOOK_ACTIVE:-false}" == "true" ]]; then
  exit 0
fi

if ! ./check.sh --fast; then
  echo "Guardrail gate is red — fix the failures above before finishing." >&2
  exit 2
fi
