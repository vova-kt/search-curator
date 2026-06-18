"""Pure HTML rendering for the Telegram adapter — no aiogram, no I/O. Everything
user- or web-derived is HTML-escaped; absent facts (no date, no price, blank
attributes) are omitted; the schedule line prefers the human echo, falls back to a
<code> cron, and reads "manual" when neither is set."""

from __future__ import annotations

from datetime import UTC, datetime

from events_curator.apps.bot.types import Delivery
from events_curator.apps.telegram.render import (
    domain_of,
    format_when,
    render_draft,
    render_result,
    render_saved_query,
)
from events_curator.models import (
    CanonicalSearchResult,
    CanonicalSearchResultId,
    Geo,
    SavedQuery,
    UserId,
    new_saved_query_id,
)
from events_curator.search_builder import SearchDraft


def _delivery(result: CanonicalSearchResult, *, domain: str | None = None) -> Delivery:
    return Delivery(saved_query_id=new_saved_query_id(), domain=domain, result=result)


# --- domain_of -------------------------------------------------------------


def test_domain_of_strips_scheme_and_www() -> None:
    assert domain_of("https://www.example.com/events/1") == "example.com"
    assert domain_of("http://venue.org/x?y=1") == "venue.org"


# --- format_when -----------------------------------------------------------


def test_format_when_renders_a_single_instant() -> None:
    when = format_when(datetime(2026, 6, 17, 20, 30, tzinfo=UTC), None)
    assert when == "17 Jun 2026, 20:30"


def test_format_when_collapses_a_same_day_span() -> None:
    start = datetime(2026, 6, 17, 20, 0, tzinfo=UTC)
    end = datetime(2026, 6, 17, 22, 0, tzinfo=UTC)
    assert format_when(start, end) == "17 Jun 2026, 20:00-22:00"


def test_format_when_spells_out_a_multi_day_span() -> None:
    start = datetime(2026, 6, 17, 20, 0, tzinfo=UTC)
    end = datetime(2026, 6, 18, 22, 0, tzinfo=UTC)
    assert format_when(start, end) == "17 Jun 2026, 20:00 - 18 Jun 2026, 22:00"


def test_format_when_is_empty_without_a_start() -> None:
    assert format_when(None, None) == ""


# --- render_result ---------------------------------------------------------


def test_render_result_links_title_and_escapes_everything() -> None:
    result = CanonicalSearchResult(
        id=CanonicalSearchResultId("c1"),
        url="https://www.venue.com/e/1",
        title="Jazz & <b>Blues</b>",
        description="A & B night",
        starts_at=datetime(2026, 6, 17, 20, 0, tzinfo=UTC),
        price="€10",
        geo=Geo(city="Berlin"),
        attributes={"organizer": "M&M", "blank": "   "},
    )
    out = render_result(_delivery(result))

    assert '<a href="https://www.venue.com/e/1">' in out
    assert "Jazz &amp; &lt;b&gt;Blues&lt;/b&gt;" in out  # title escaped
    assert "🔗 venue.com" in out  # domain, www stripped
    assert "📅 17 Jun 2026, 20:00" in out
    assert "💶 €10" in out
    assert "A &amp; B night" in out  # description escaped
    assert "Organizer" in out  # attribute label title-cased
    assert "M&amp;M" in out  # attribute value escaped
    assert "Blank" not in out  # blank attribute dropped


def test_render_result_omits_absent_facts() -> None:
    result = CanonicalSearchResult(
        id=CanonicalSearchResultId("c2"),
        url="https://e.com/x",
        title="Bare",
    )
    out = render_result(_delivery(result))

    assert "📅" not in out
    assert "💶" not in out
    lines = out.splitlines()
    assert lines == ['<b><a href="https://e.com/x">Bare</a></b>', "🔗 e.com"]


# --- render_draft ----------------------------------------------------------


def test_render_draft_shows_every_gathered_field() -> None:
    draft = SearchDraft(
        text="jazz",
        city="Berlin",
        schedule_cron="0 9 * * 1",
        schedule_text="every Monday 09:00 UTC",
        max_results_shown=5,
    )
    out = render_draft(draft)

    assert "New recurring search" in out
    assert "🔎 jazz" in out
    assert "📍 Berlin" in out
    assert "⏰ every Monday 09:00 UTC" in out
    assert "📨 up to 5 results per run" in out


def test_render_draft_falls_back_to_a_code_cron() -> None:
    draft = SearchDraft(text="jazz", schedule_cron="0 9 * * 1")
    assert "⏰ <code>0 9 * * 1</code>" in render_draft(draft)


def test_render_draft_reads_manual_without_a_schedule() -> None:
    assert "manual (run on demand)" in render_draft(SearchDraft(text="jazz"))


# --- render_saved_query ----------------------------------------------------


def test_render_saved_query_escapes_and_marks_disabled() -> None:
    query = SavedQuery(
        user_id=UserId("u"),
        text="Jazz & Blues",
        city="Berlin",
        schedule_text="weekly",
        enabled=False,
    )
    out = render_saved_query(query)

    assert "Jazz &amp; Blues" in out
    assert "📍 Berlin" in out
    assert "⏰ weekly" in out
    assert "⏸ disabled" in out
