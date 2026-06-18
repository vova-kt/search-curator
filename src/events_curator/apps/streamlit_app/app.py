"""Streamlit operator console over the events DB — the package entrypoint.

Run with:  streamlit run src/events_curator/apps/streamlit_app/app.py
Streamlit is a base dependency; a live pipeline run additionally needs the
`store` extra (to persist) and the `llm`/`embed` extras (the real search / rank /
feedback adapters). A left-hand menu (`st.navigation`) switches between three
sections; only the selected one runs:

- **Query results** (`_results_view.render_results`) — a local-only console that
  lists the operator's saved queries, runs a chosen one through the real pipeline,
  and records like/dislike feedback. It writes, so it goes through `build_storage`.
- **New query** (`_query_view.render_new_query`) — the local-only create form.
- **Database** (`_db.render_db_view`) — a read-only window onto the SQLite file
  (opens it `mode=ro`), for inspecting what the scheduler wrote. It never writes.

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
