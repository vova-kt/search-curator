"""Cron due-calculation for the scheduler. Shared by the bot's tick loop and the
standalone `SchedulerServer`, so both decide "is this saved query due now?" the
same way.

The "skip missed runs" rule lives here: a query is due when its most recent
scheduled fire-time at-or-before *now* is later than the last time it ran (or its
creation, if it never ran). After downtime that spans several fires, this triggers
exactly one catch-up run, not one per missed fire.
"""

from __future__ import annotations

from datetime import UTC, datetime

from croniter import croniter


def now_utc() -> datetime:
    return datetime.now(tz=UTC)


def is_valid_cron(expression: str) -> bool:
    return croniter.is_valid(expression)


def _prev_fire(expression: str, now: datetime) -> datetime:
    return croniter(expression, now).get_prev(datetime)


def next_fire(expression: str, base: datetime) -> datetime:
    """The next scheduled fire-time strictly after `base` (for display/logging)."""
    return croniter(expression, base).get_next(datetime)


def is_due(expression: str, since: datetime, now: datetime) -> bool:
    """Whether a query on `expression` is due at `now`, given it last fired at
    `since` (pass `last_run_at` or, if it never ran, `created_at`). False for an
    invalid expression so a malformed cron simply never schedules."""
    if not is_valid_cron(expression):
        return False
    return _prev_fire(expression, now) > since
