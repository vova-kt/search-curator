"""The Streamlit console's read-only **Database** section: a window onto the SQLite
file the scheduler writes. It opens the DB `mode=ro` and never writes."""

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


def render_db_view() -> None:
    db_path = get_config().storage.db_path
    st.bottom.caption(f"`{db_path}` (read-only)")
    conn = _connect(db_path)
    if conn is None:
        st.info("No database yet. Run a query, or let the scheduler create it.")
        return
    tables = _table_names(conn)
    if not tables:
        st.info("Database has no tables yet.")
        return
    table = st.selectbox("Table", tables, key="db_table")
    if table in tables:
        st.subheader(table)
        st.dataframe(_rows(conn, table), width="stretch")
