from __future__ import annotations

from events_curator.apps.streamlit_app._results_view import format_attributes


def test_format_attributes_humanizes_keys_and_prefixes_configured_emoji() -> None:
    out = format_attributes(
        {"organizer": "ACM", "ticket_price": "free"},
        emojis={"organizer": "🏛️"},  # ticket_price has no spec → renders plain
    )
    assert out == "🏛️ **Organizer:** ACM  ·  **Ticket Price:** free"


def test_format_attributes_empty_is_empty_string() -> None:
    assert format_attributes({}, emojis={}) == ""
