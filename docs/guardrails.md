# Guardrails — keeping the code clean across many AI iterations

This project is built and changed mostly by an AI assistant, so every rule we care
about must be **machine-checked**, surfacing as one signal: **green = OK, red =
fix it.** [CLAUDE.md](../CLAUDE.md) lists the rules in prose; this page is how the
mechanical ones get enforced. Rules that can't be machine-checked (e.g. "docs
explain why, not what") still rely on review.

## The gate

`check.sh` is a single command, green or red, in two forms:

- **`check.sh --fast`** — static type-checking, the linter, and the formatting check.
  Fast enough to run automatically after every turn.
- **`check.sh`** — the fast checks **plus the test suite**. Run it before committing
  or when you want full confidence.

If `check.sh` is green, the change is, by our definition, safe to keep.

## What it enforces

Beyond types, lint, and formatting (one automated style, never argued over), two
checks keep the structure from drifting:

- **Size and complexity caps** — a source file can't pass ~300 lines, a function ~80,
  nor be too branchy or deeply nested. Hitting a cap forces splitting the work into
  smaller named pieces. (Tests are exempt from the line cap.)
- **Module boundaries** — each folder is a sealed unit with one public door
  (`__init__.py`); code elsewhere may not reach past it into internals, and no two
  pieces may depend on each other in a circle. (Test code is exempt.)

## Three safety nets

The same full gate runs at three points, so nothing red survives:

1. **After each turn** — a hook runs `check.sh --fast`; if it fails the errors go
   straight back to the assistant, which gets **one** auto-fix attempt before the
   failure is surfaced to the human (so the loop can't spin forever).
2. **At commit time** — a pre-commit hook runs the full gate; switched on once per
   clone with a single setup command.
3. **In CI** — GitHub Actions runs `./check.sh` on every push to `master`
   (`.github/workflows/check.yml`, `uv sync` on Python 3.13), catching anything that
   bypassed the local hook.
