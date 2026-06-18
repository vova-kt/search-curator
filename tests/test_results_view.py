from __future__ import annotations

from datetime import UTC, datetime

from events_curator.apps.streamlit_app._results_view import format_facts, format_when


def test_format_facts_humanizes_keys_and_prefixes_configured_emoji() -> None:
    out = format_facts(
        {"organizer": "ACM", "ticket_price": "free"},
        emojis={"organizer": "🏛️"},  # ticket_price has no spec → renders plain
    )
    assert out == ":gray-badge[🏛️ Organizer] ACM  \n:gray-badge[Ticket Price] free"


def test_format_facts_leads_with_when_and_price_then_attributes() -> None:
    out = format_facts(
        {"organizer": "ACM"},
        emojis={"organizer": "🏛️"},
        starts_at=datetime(2026, 6, 24, 19, 0, tzinfo=UTC),
        price="15€",
    )
    assert out == (
        ":gray-badge[📅 When] 24 Jun 2026, 19:00  \n"
        ":gray-badge[💶 Price] 15€  \n"
        ":gray-badge[🏛️ Organizer] ACM"
    )


def test_format_facts_empty_is_empty_string() -> None:
    assert format_facts({}, emojis={}) == ""


def test_format_when_single_instant() -> None:
    assert format_when(datetime(2026, 6, 24, 19, 0, tzinfo=UTC), None) == "24 Jun 2026, 19:00"


def test_format_when_same_day_span_shows_only_end_time() -> None:
    out = format_when(
        datetime(2026, 6, 24, 19, 0, tzinfo=UTC), datetime(2026, 6, 24, 22, 0, tzinfo=UTC)
    )
    assert out == "24 Jun 2026, 19:00-22:00"


def test_format_when_multi_day_span_shows_both_dates() -> None:
    out = format_when(
        datetime(2026, 6, 24, 19, 0, tzinfo=UTC), datetime(2026, 6, 25, 2, 0, tzinfo=UTC)
    )
    assert out == "24 Jun 2026, 19:00 - 25 Jun 2026, 02:00"


def test_format_when_unknown_start_is_empty() -> None:
    assert format_when(None, None) == ""
