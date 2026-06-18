from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime

import streamlit as st

from events_curator.apps.streamlit_app.console import (
    console_principal,
    run,
    run_query,
)
from events_curator.auth import NotOwnerError
from events_curator.enums import FeedbackKind
from events_curator.models import CanonicalSearchResult, Feedback, Principal, SavedQuery
from events_curator.pipeline import UnknownSavedQueryError
from events_curator.search import emojis_for


def render_results() -> None:
    principal = console_principal()
    if principal is None:
        return
    queries = run(lambda storage, _pipeline: storage.queries.list_for_user(principal.user_id))
    if not queries:
        st.info("No saved queries yet. Create one in the **New query** section.")
        return
    labels = {q.id: f"{q.text}  -  {q.city or 'any city'}" for q in queries}
    chosen = st.selectbox(
        "Query", options=[q.id for q in queries], format_func=lambda qid: labels[qid]
    )
    query = next(q for q in queries if q.id == chosen)

    if st.button("Run now", type="primary"):
        run_query(query, principal)
    _feedback_section(query, principal)


def _feedback_section(query: SavedQuery, principal: Principal) -> None:
    results = run(lambda storage, _pipeline: storage.results.results_for_query(query.id))
    if not results:
        st.caption(
            "No stored results yet. Run the query (needs the llm/embed extras) "
            "or let the scheduler populate it."
        )
        return
    # Tighten the vertical gap between stacked result cards below the page default.
    with st.container(gap="xsmall"):
        for result in results:
            _result_row(query, principal, result)


def _badge(emoji: str | None, label: str, value: str) -> str:
    """One fact line: a gray badge carrying `emoji label` (emoji dropped when None),
    then the value beside it."""
    text = f"{emoji} {label}" if emoji else label
    return f":gray-badge[{text}] {value}"


def format_when(starts_at: datetime | None, ends_at: datetime | None) -> str:
    """A compact human date: a single instant, a same-day time span, or a multi-day
    span. Empty when the start is unknown."""
    if starts_at is None:
        return ""
    start = starts_at.strftime("%-d %b %Y, %H:%M")
    if ends_at is None:
        return start
    if ends_at.date() == starts_at.date():
        return f"{start}-{ends_at.strftime('%H:%M')}"
    return f"{start} - {ends_at.strftime('%-d %b %Y, %H:%M')}"


def format_facts(
    attributes: Mapping[str, str],
    emojis: Mapping[str, str],
    *,
    starts_at: datetime | None = None,
    ends_at: datetime | None = None,
    price: str | None = None,
) -> str:
    """Render a result's facts as one gray badge per line: the typed when/price fields
    first, then the domain's free-form attributes. Each badge carries an emoji (the
    catalog's for attribute keys, fixed glyphs for when/price) + humanized label, then
    the value. Lines join with markdown hard breaks so each fact sits on its own row."""
    lines: list[str] = []
    when = format_when(starts_at, ends_at)
    if when:
        lines.append(_badge("📅", "When", when))
    if price:
        lines.append(_badge("💶", "Price", price))
    for key, value in attributes.items():
        lines.append(_badge(emojis.get(key), key.replace("_", " ").title(), value))
    return "  \n".join(lines)


def _result_row(query: SavedQuery, principal: Principal, result: CanonicalSearchResult) -> None:
    with st.container(border=True, gap="small"):
        heading, actions = st.columns([6, 2], gap="xsmall", vertical_alignment="center")
        heading.markdown(f"**[{result.title}]({result.url})**")
        with actions.container(horizontal=True, horizontal_alignment="right", gap="xsmall"):
            if st.button("👍", key=f"like:{result.id}"):
                _feedback_dialog(query, principal, result, FeedbackKind.LIKE)
            if st.button("👎", key=f"dislike:{result.id}"):
                _feedback_dialog(query, principal, result, FeedbackKind.DISLIKE)
        facts_col, description, _ = st.columns(3, gap="small")
        if result.description:
            description.caption(result.description)
        facts = format_facts(
            result.attributes,
            emojis_for(query.domain),
            starts_at=result.starts_at,
            ends_at=result.ends_at,
            price=result.price,
        )
        if facts:
            facts_col.caption(facts)


@st.dialog("Add feedback")
def _feedback_dialog(
    query: SavedQuery, principal: Principal, result: CanonicalSearchResult, kind: FeedbackKind
) -> None:
    st.markdown(f"[{result.title}]({result.url})")
    reason = st.text_area("Comment (optional)", key=f"reason:{result.id}")
    symbol = "👍" if kind == FeedbackKind.LIKE else "👎"
    if st.button(f"Submit  {symbol}", type="primary") and _send_feedback(
        query, principal, result, kind, reason or None
    ):
        st.rerun()


def _send_feedback(
    query: SavedQuery,
    principal: Principal,
    result: CanonicalSearchResult,
    kind: FeedbackKind,
    reason: str | None = None,
) -> bool:
    feedback = Feedback(
        saved_query_id=query.id,
        canonical_search_result_id=result.id,
        kind=kind,
        reason=reason or None,
    )
    try:
        run(lambda _storage, pipeline: pipeline.record_feedback(feedback, principal))
    except NotImplementedError as exc:
        st.toast(f"Feedback stored; profile update hit an unconfigured stage: {exc}")
        return True
    except (NotOwnerError, UnknownSavedQueryError) as exc:
        st.error(str(exc))
        return False
    st.toast(f"Recorded {kind.value} for '{result.title}'.")
    return True
