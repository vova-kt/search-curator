from __future__ import annotations

import streamlit as st

from events_curator.apps.streamlit_app.console import console_principal, run
from events_curator.models import Principal, SavedQuery


def render_new_query() -> None:
    principal = console_principal()
    if principal is None:
        return
    st.subheader("New saved query")
    _new_query_form(principal)


def _new_query_form(principal: Principal) -> None:
    with st.form("new_query", clear_on_submit=True):
        text = st.text_input("Search text", placeholder="jazz concerts in Berlin")
        left, right = st.columns(2, gap="xsmall")
        city = left.text_input("City (optional)")
        country = right.text_input("Country (optional)")
        tags_raw = st.text_input("Tags (comma-separated, optional)")
        submitted = st.form_submit_button("Save query")
    if not submitted:
        return
    if not text.strip():
        st.warning("Search text is required.")
        return
    query = SavedQuery(
        user_id=principal.user_id,
        text=text.strip(),
        city=city.strip() or None,
        country=country.strip() or None,
        tags=[t.strip() for t in tags_raw.split(",") if t.strip()],
    )
    run(lambda storage, _pipeline: storage.queries.upsert(query))
    st.success(f"Saved '{query.text}'.")
    st.rerun()
