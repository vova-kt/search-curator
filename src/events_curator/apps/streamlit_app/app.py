"""Streamlit operator console over the events DB — the package entrypoint.

Run with:  streamlit run src/events_curator/apps/streamlit_app/app.py

The two console sections refuse to load under any non-LOCAL `AuthScheme`: this is
a single-operator tool. They still mint a `Principal` through the `auth` module so
the pipeline's ownership checks run unchanged rather than being bypassed.
"""

from __future__ import annotations

import streamlit as st

from events_curator.apps.streamlit_app._db import render_db_view
from events_curator.apps.streamlit_app._query_view import render_new_query
from events_curator.apps.streamlit_app._results_view import render_results
from events_curator.config import get_config, setup_logging
from events_curator.enums import LogLevel


def main() -> None:
    st.set_page_config(page_title="events-curator", layout="wide")
    # The operator console always runs at DEBUG, regardless of the configured log level.
    setup_logging(get_config(), level_override=LogLevel.DEBUG)
    st.navigation(
        [
            st.Page(render_results, title="Query results", url_path="results", default=True),
            st.Page(render_new_query, title="New query", url_path="new-query"),
            st.Page(render_db_view, title="Database", url_path="database"),
        ],
        position="top",
    ).run()


if __name__ == "__main__":
    main()
