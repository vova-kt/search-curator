"""Read-only Streamlit view over the events DB.

Run with:  streamlit run src/events_curator/apps/streamlit_app.py
Needs the `ui` extra (streamlit). It opens the SQLite file read-only and lets
you browse tables — a quick operator window into what the pipeline has stored.
Until the SQLite adapter creates the schema, it shows an empty-DB notice.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import streamlit as st

from events_curator.config import get_config

ROW_LIMIT = 500


def _connect(db_path: str) -> sqlite3.Connection | None:
    if not Path(db_path).exists():
        return None
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _table_names(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    return [r["name"] for r in rows]


def _rows(conn: sqlite3.Connection, table: str) -> list[dict[str, object]]:
    cursor = conn.execute(f'SELECT * FROM "{table}" LIMIT {ROW_LIMIT}')
    return [dict(r) for r in cursor.fetchall()]


def main() -> None:
    st.set_page_config(page_title="events-curator DB", layout="wide")
    st.title("events-curator — database view")

    db_path = get_config().storage.db_path
    st.caption(f"DB: `{db_path}`")

    conn = _connect(db_path)
    if conn is None:
        st.info("No database yet. Run the pipeline (with the SQLite adapter) to create it.")
        return

    tables = _table_names(conn)
    if not tables:
        st.info("Database has no tables yet.")
        return

    table = st.sidebar.selectbox("Table", tables)
    if table in tables:
        st.subheader(table)
        st.dataframe(_rows(conn, table), use_container_width=True)


main()
