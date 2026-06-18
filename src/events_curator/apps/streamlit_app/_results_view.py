from __future__ import annotations

from collections.abc import Mapping

import streamlit as st

from events_curator.apps.streamlit_app.console import (
    console_principal,
    run,
    run_query,
)
from events_curator.auth import NotOwnerError
from events_curator.config import get_config
from events_curator.enums import FeedbackKind
from events_curator.models import CanonicalSearchResult, Feedback, Principal, SavedQuery
from events_curator.pipeline import UnknownSavedQueryError


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
    st.subheader("Results & feedback")
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


def format_attributes(attributes: dict[str, str], emojis: Mapping[str, str]) -> str:
    """Render a result's attributes for display, prefixing each with the emoji its
    `[search].attributes` spec defines (keys outside the vocabulary render plain)."""
    parts: list[str] = []
    for key, value in attributes.items():
        prefix = f"{emojis[key]} " if key in emojis else ""
        parts.append(f"{prefix}**{key.replace('_', ' ').title()}:** {value}")
    return "\n".join(parts)


def _result_row(query: SavedQuery, principal: Principal, result: CanonicalSearchResult) -> None:
    with st.container(border=True):
        info, actions = st.columns([6, 2], gap="xsmall", vertical_alignment="center")
        info.markdown(f"**[{result.title}]({result.url})**")
        if result.description:
            info.caption(result.description)
        if result.attributes:
            emojis = {key: spec.emoji for key, spec in get_config().search.attributes.items()}
            info.caption(format_attributes(result.attributes, emojis))
        with actions.container(horizontal=True, horizontal_alignment="right", gap="xsmall"):
            if st.button("👍", key=f"like:{result.id}"):
                _feedback_dialog(query, principal, result, FeedbackKind.LIKE)
            if st.button("👎", key=f"dislike:{result.id}"):
                _feedback_dialog(query, principal, result, FeedbackKind.DISLIKE)


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
