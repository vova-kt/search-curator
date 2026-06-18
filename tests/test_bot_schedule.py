"""Cron due-calculation for the bot/scheduler tick. `is_valid_cron` gates malformed
expressions, `next_fire` is the next instant strictly after a base, and `is_due`
encodes the "skip missed runs" rule: a query is due when its most recent scheduled
fire at-or-before now is later than when it last ran — so a multi-fire outage
triggers exactly one catch-up, not one run per missed fire."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from events_curator.apps.bot.schedule import is_due, is_valid_cron, next_fire, now_utc

_DAILY_9 = "0 9 * * *"
_BASE = datetime(2026, 6, 17, 12, 0, tzinfo=UTC)


def test_is_valid_cron_accepts_a_five_field_expression() -> None:
    assert is_valid_cron("0 9 * * 1")


def test_is_valid_cron_rejects_garbage() -> None:
    assert not is_valid_cron("not a cron")
    assert not is_valid_cron("")


def test_now_utc_is_timezone_aware_utc() -> None:
    assert now_utc().tzinfo is UTC


def test_next_fire_is_strictly_after_the_base() -> None:
    # 12:00 base, daily 09:00 fire -> the next one is tomorrow.
    assert next_fire(_DAILY_9, _BASE) == datetime(2026, 6, 18, 9, 0, tzinfo=UTC)


def test_is_due_when_a_fire_elapsed_since_the_last_run() -> None:
    since = _BASE - timedelta(days=1)  # ran yesterday noon; today's 09:00 has fired
    assert is_due(_DAILY_9, since, _BASE)


def test_is_not_due_when_no_fire_since_the_last_run() -> None:
    since = datetime(2026, 6, 17, 10, 0, tzinfo=UTC)  # ran after today's 09:00 fire
    assert not is_due(_DAILY_9, since, _BASE)


def test_is_due_collapses_a_multi_fire_outage_to_one() -> None:
    # Five days of downtime: only the most recent fire matters, so a single
    # is_due call returns True (the caller then advances last_run_at, ending it).
    assert is_due(_DAILY_9, _BASE - timedelta(days=5), _BASE)


def test_invalid_cron_is_never_due() -> None:
    assert not is_due("nonsense", _BASE - timedelta(days=1), _BASE)
