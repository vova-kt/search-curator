"""Streamlit operator console over the events DB.

Run with:  streamlit run src/events_curator/apps/streamlit_app.py
Streamlit is a base dependency; a live pipeline run additionally needs the
`store` extra (to persist) and the `llm`/`embed` extras (the real search / rank /
feedback adapters). Two tabs:

- **Database** — a read-only window onto the SQLite file (opens it `mode=ro`),
  for inspecting what the scheduler wrote. It never writes.
- **Run & feedback** — a local-only console that lists the operator's saved
  queries, creates new ones, runs them through the real pipeline, and records
  like/dislike feedback. It writes, so it goes through `build_storage` (SQLite),
  not the read-only connection.

The console refuses to load under any non-LOCAL `AuthScheme`: it is a single-
operator tool. It still mints a `Principal` through the `auth` module so the
pipeline's ownership checks run unchanged rather than being bypassed.
"""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import Awaitable, Callable
from pathlib import Path

import streamlit as st

from events_curator.auth import NotOwnerError
from events_curator.config import get_config, setup_logging
from events_curator.enums import AuthScheme, FeedbackKind, LogLevel
from events_curator.models import (
    CanonicalSearchResult,
    Feedback,
    Principal,
    SavedQuery,
    User,
)
from events_curator.pipeline import (
    IN_MEMORY_DB_PATH,
    CurationPipeline,
    UnknownSavedQueryError,
    build_authenticator,
    build_default_pipeline,
    build_storage,
)
from events_curator.storage import Storage

ROW_LIMIT = 500
LOCAL_CREDENTIAL = "local"


# --- read-only database view -------------------------------------------------
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


def _render_db_view() -> None:
    db_path = get_config().storage.db_path
    st.caption(f"DB: `{db_path}` (read-only)")
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


# --- run & feedback console --------------------------------------------------
def _run[T](action: Callable[[Storage, CurationPipeline], Awaitable[T]]) -> T:
    """Open the configured store, build a pipeline, run one async action, close."""

    async def _go() -> T:
        config = get_config()
        storage = build_storage(config)
        await storage.init()
        try:
            return await action(storage, build_default_pipeline(config, storage))
        finally:
            await storage.close()

    return asyncio.run(_go())


def _authenticate() -> Principal | None:
    async def _action(storage: Storage, _pipeline: CurationPipeline) -> Principal | None:
        principal = await build_authenticator(get_config()).authenticate(LOCAL_CREDENTIAL)
        if principal is None:
            return None
        if await storage.users.get(principal.user_id) is None:
            await storage.users.upsert(User(id=principal.user_id, display_name=LOCAL_CREDENTIAL))
        return principal

    return _run(_action)


def _new_query_form(principal: Principal) -> None:
    with st.form("new_query", clear_on_submit=True):
        text = st.text_input("Search text", placeholder="jazz concerts in Berlin")
        left, right = st.columns(2)
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
    _run(lambda storage, _pipeline: storage.queries.upsert(query))
    st.success(f"Saved '{query.text}'.")
    st.rerun()


def _run_query(query: SavedQuery, principal: Principal) -> None:
    try:
        ranked = _run(lambda _storage, pipeline: pipeline.run(query.id, principal))
    except NotImplementedError as exc:
        st.info(f"Pipeline reached an unconfigured stage (wire the relevant extra): {exc}")
        return
    except (NotOwnerError, UnknownSavedQueryError) as exc:
        st.error(str(exc))
        return
    st.success(f"Run complete - {len(ranked)} ranked result(s).")
    if ranked:
        st.dataframe(
            [
                {
                    "rank": r.rank,
                    "score": round(r.score, 4),
                    "id": r.canonical_search_result_id,
                    "rationale": r.rationale,
                    "exploration": r.is_exploration,
                }
                for r in ranked
            ],
            width="stretch",
        )


def _send_feedback(
    query: SavedQuery, principal: Principal, result: CanonicalSearchResult, kind: FeedbackKind
) -> None:
    feedback = Feedback(
        saved_query_id=query.id,
        canonical_search_result_id=result.id,
        kind=kind,
    )
    try:
        _run(lambda _storage, pipeline: pipeline.record_feedback(feedback, principal))
    except NotImplementedError as exc:
        st.info(f"Feedback stored; profile update hit an unconfigured stage: {exc}")
        return
    except (NotOwnerError, UnknownSavedQueryError) as exc:
        st.error(str(exc))
        return
    st.success(f"Recorded {kind.value} for '{result.title}'.")


def _result_row(query: SavedQuery, principal: Principal, result: CanonicalSearchResult) -> None:
    st.markdown(f"**[{result.title}]({result.url})**")
    if result.description:
        st.caption(result.description)
    like, dislike = st.columns(2)
    if like.button("Like", key=f"like:{result.id}"):
        _send_feedback(query, principal, result, FeedbackKind.LIKE)
    if dislike.button("Dislike", key=f"dislike:{result.id}"):
        _send_feedback(query, principal, result, FeedbackKind.DISLIKE)
    st.divider()


def _feedback_section(query: SavedQuery, principal: Principal) -> None:
    results = _run(lambda storage, _pipeline: storage.results.results_for_query(query.id))
    if not results:
        st.caption(
            "No stored results yet. Run the query (needs the llm/embed extras) "
            "or let the scheduler populate it."
        )
        return
    for result in results:
        _result_row(query, principal, result)


def _console_blocked_reason() -> str | None:
    config = get_config()
    if config.auth.scheme is not AuthScheme.LOCAL:
        return (
            f"The run & feedback console is local-only; AUTH__SCHEME is "
            f"'{config.auth.scheme.value}'. Set it to 'local' to use this tab."
        )
    if config.storage.db_path == IN_MEMORY_DB_PATH:
        return "STORAGE__DB_PATH is ':memory:'; the console needs a file-backed DB to persist."
    return None


def _render_console() -> None:
    blocked = _console_blocked_reason()
    if blocked is not None:
        st.warning(blocked)
        return
    principal = _authenticate()
    if principal is None:
        st.error("Authentication failed.")
        return
    st.caption(f"Acting as `{principal.user_id}` ({principal.scheme.value}).")

    st.subheader("New saved query")
    _new_query_form(principal)

    queries = _run(lambda storage, _pipeline: storage.queries.list_for_user(principal.user_id))
    st.subheader("Your saved queries")
    if not queries:
        st.info("No saved queries yet. Create one above.")
        return
    labels = {q.id: f"{q.text}  -  {q.city or 'any city'}" for q in queries}
    chosen = st.selectbox(
        "Query", options=[q.id for q in queries], format_func=lambda qid: labels[qid]
    )
    query = next(q for q in queries if q.id == chosen)

    if st.button("Run now", type="primary"):
        _run_query(query, principal)
    st.subheader("Results & feedback")
    _feedback_section(query, principal)


def main() -> None:
    # The operator console always runs at DEBUG, regardless of LOGGING__LEVEL in .env.
    setup_logging(get_config(), level_override=LogLevel.DEBUG)
    st.set_page_config(page_title="events-curator", layout="wide")
    st.title("events-curator")
    db_tab, console_tab = st.tabs(["Database", "Run & feedback"])
    with db_tab:
        _render_db_view()
    with console_tab:
        _render_console()


main()
