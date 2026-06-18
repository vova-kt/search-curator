# Guardrails — keeping the code clean across many AI iterations

## Why this exists

This project is built and changed mostly by an AI coding assistant.
So every rule we care about must be **checked by a machine**, not by a human's
judgment, and the result must be a single signal anyone can read: **green = OK,
red = ask the assistant to fix it.**

The whole approach has two layers:

1. **One gate** — a single command, `check.sh`, that is either green or red.
2. **An automatic feedback loop** — after the assistant finishes working, the gate
   runs by itself; if it's red, the failures are handed straight back to the
   assistant to fix in the same session. The operator usually never sees them.

## The gate

There are two forms, on purpose:

- **`check.sh --fast`** — the quick checks: static type-checking, the linter,
  and the formatting check. Fast enough to run automatically after every turn.
- **`check.sh`** — the full gate: the fast checks **plus the test suite**.
  this  is the form to run before committing or when you want full confidence.

If `check.sh` is green, the change is, by our definition, safe to keep.

## Keeping it simple and decoupled

Two more machine checks keep the structure from drifting as the code grows:

- **Size and complexity caps.** A source file can't grow past ~300 lines, a single
  function past ~80, and no function may be too tangled (too many branches or too
  deeply nested). When the assistant bumps a cap, it's forced to split the work
  into smaller named pieces instead of growing one blob — which is exactly what
  keeps the code readable. (Tests are exempt from the line cap — fixtures and
  table-driven cases legitimately run long.)
- **Module boundaries.** Each folder of code is treated as a sealed unit with one
  public door (its `__init__.py`). Code elsewhere may knock on that door but may not
  reach past it into the folder's internals, and no two pieces may depend on each
  other in a circle. This is what stops everything from quietly becoming entangled
  with everything else. (Test code is exempt — it's allowed to inspect internals.)

Formatting is fully automated (one consistent style, applied on save and verified
by the gate), so style is never a thing anyone argues about or reviews.

## A second safety net at commit time

The same full gate also runs automatically just before any commit, so nothing red
can be committed even when the assistant isn't the one doing it. This needs to be
switched on once per copy of the project with a single setup command (recorded in
the project's setup notes); after that it's automatic.

## A third safety net in CI

The full gate also runs in GitHub Actions on every push to `master`
(`.github/workflows/check.yml`): it installs with `uv sync` on Python 3.13 and
runs `./check.sh`. This catches anything that reached the shared branch even if
the local commit-time hook was bypassed.

## The automatic feedback loop

When the assistant finishes a turn, a hook runs `check.sh --fast` on its own. If it
fails, the errors are returned to the assistant, which fixes them and finishes
again. To make sure this can never spin forever, the loop is allowed **one**
auto-fix attempt; if it's still red after that, the failure is surfaced to the
human instead of being retried endlessly.

## How this maps to the project rules

[CLAUDE.md](../CLAUDE.md) lists the project rules in prose. This page is how the
_mechanical_ ones get enforced rather than merely hoped for. Rules that can't be
machine-checked (e.g. "docs explain why, not what") still rely on review.

## What's enforced today

All of it is now live: static type-checking, the linter (size/complexity caps and
module boundaries), automatic formatting, and the test suite — wrapped in the
`check.sh` gate, run automatically after each assistant turn and again before
every commit.

