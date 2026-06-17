#!/usr/bin/env bash
# The single guardrail gate. Green = safe to keep. See docs/guardrails.md.
#
#   check.sh --fast   type-check + lint + format-check + boundaries + size caps
#   check.sh          the above PLUS the test suite (use before committing)
#
# Every check appends to a failure list; we run them all, then report once.
set -uo pipefail
cd "$(dirname "$0")" || exit 1

FAST=0
[[ "${1:-}" == "--fast" ]] && FAST=1

MAX_FILE_LINES=300
fails=()
run() { # run "<label>" <cmd...>
  local label="$1"; shift
  echo "▶ $label"
  if ! "$@"; then fails+=("$label"); fi
}

# --- size cap: no source file may exceed MAX_FILE_LINES (guardrails) ----------
check_file_sizes() {
  local over=0 f lines
  while IFS= read -r f; do
    lines=$(wc -l <"$f")
    if (( lines > MAX_FILE_LINES )); then
      echo "  $f: $lines lines (cap $MAX_FILE_LINES)"; over=1
    fi
  done < <(find src tests -name '*.py' 2>/dev/null)
  return $over
}

run "type-check (pyright)"   uv run pyright
run "lint (ruff)"            uv run ruff check .
run "format (ruff)"          uv run ruff format --check .
run "boundaries (import-linter)" uv run lint-imports
run "file-size cap"          check_file_sizes

if (( FAST == 0 )); then
  run "tests (pytest)"       uv run pytest
fi

echo
if (( ${#fails[@]} )); then
  printf '✗ gate RED — %d check(s) failed:\n' "${#fails[@]}" >&2
  printf '   - %s\n' "${fails[@]}" >&2
  exit 1
fi
echo "✓ gate GREEN"
