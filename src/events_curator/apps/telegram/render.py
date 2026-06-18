"""Pure HTML rendering for the Telegram adapter — no aiogram, no I/O, so it unit-
tests as plain string functions. Everything user- or web-derived is HTML-escaped;
the layout mirrors the Streamlit result card (title link, domain, when, price, the
domain's non-empty attributes, then the description)."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from html import escape
from urllib.parse import urlsplit

from events_curator.apps.bot.types import Delivery
from events_curator.models import CanonicalSearchResult, SavedQuery
from events_curator.search import emojis_for
from events_curator.search_builder import SearchDraft


def domain_of(url: str) -> str:
    """The bare host of a URL (no scheme, no `www.`, no path) for compact display."""
    host = urlsplit(url).netloc or url
    return host[4:] if host.startswith("www.") else host


def format_when(starts_at: datetime | None, ends_at: datetime | None) -> str:
    """A compact human date: a single instant, a same-day span, or a multi-day span.
    Empty when the start is unknown."""
    if starts_at is None:
        return ""
    start = starts_at.strftime("%-d %b %Y, %H:%M")
    if ends_at is None:
        return start
    if ends_at.date() == starts_at.date():
        return f"{start}-{ends_at.strftime('%H:%M')}"
    return f"{start} - {ends_at.strftime('%-d %b %Y, %H:%M')}"


def _fact(emoji: str, value: str) -> str:
    return f"{emoji} {escape(value)}"


def _attribute_lines(attributes: Mapping[str, str], emojis: Mapping[str, str]) -> list[str]:
    lines: list[str] = []
    for key, value in attributes.items():
        if not value.strip():
            continue
        label = key.replace("_", " ").title()
        emoji = emojis.get(key, "•")
        lines.append(f"{emoji} <b>{escape(label)}</b>: {escape(value)}")
    return lines


def render_result(delivery: Delivery) -> str:
    """The HTML body of one result message: bold title linking to the source, then
    one fact per line. Pair with a feedback keyboard at the call site."""
    result: CanonicalSearchResult = delivery.result
    lines = [f'<b><a href="{escape(result.url)}">{escape(result.title)}</a></b>']
    lines.append(_fact("🔗", domain_of(result.url)))
    when = format_when(result.starts_at, result.ends_at)
    if when:
        lines.append(_fact("📅", when))
    if result.price:
        lines.append(_fact("💶", result.price))
    lines.extend(_attribute_lines(result.attributes, emojis_for(delivery.domain)))
    if result.description.strip():
        lines.append(f"\n{escape(result.description)}")
    return "\n".join(lines)


def _schedule_line(draft_or_query: SearchDraft | SavedQuery) -> str:
    if draft_or_query.schedule_text:
        return escape(draft_or_query.schedule_text)
    if draft_or_query.schedule_cron:
        return f"<code>{escape(draft_or_query.schedule_cron)}</code>"
    return "manual (run on demand)"


def render_draft(draft: SearchDraft) -> str:
    """The confirmation summary shown before a draft is saved."""
    lines = ["<b>New recurring search</b>", _fact("🔎", draft.text)]
    if draft.city:
        lines.append(_fact("📍", draft.city))
    lines.append(f"⏰ {_schedule_line(draft)}")
    lines.append(f"📨 up to {draft.max_results_shown} results per run")
    return "\n".join(lines)


def render_saved_query(query: SavedQuery) -> str:
    """One saved search rendered for the list view."""
    where = f" · 📍 {escape(query.city)}" if query.city else ""
    status = "" if query.enabled else " · ⏸ disabled"
    return f"<b>{escape(query.text)}</b>{where}\n⏰ {_schedule_line(query)}{status}"
