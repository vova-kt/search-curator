"""Shared run/auth plumbing for the console's two writable pages (`_results_view`,
`_query_view`). `run` opens the configured store, builds a pipeline, runs one async
action, and closes; `console_principal` is the gate both pages call first — it
refuses any non-LOCAL `AuthScheme` and a `:memory:` DB, but still mints a `Principal`
through the `auth` module so the pipeline's ownership checks run unchanged."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

import streamlit as st
from streamlit.elements.lib.mutable_status_container import StatusContainer

from events_curator.auth import NotOwnerError
from events_curator.config import get_config
from events_curator.enums import AuthScheme, ProgressPhase
from events_curator.models import (
    Principal,
    SavedQuery,
    User,
)
from events_curator.pipeline import (
    IN_MEMORY_DB_PATH,
    CurationPipeline,
    ProgressEvent,
    UnknownSavedQueryError,
    build_authenticator,
    build_default_pipeline,
    build_storage,
)
from events_curator.storage import Storage

LOCAL_CREDENTIAL = "local"


def run[T](action: Callable[[Storage, CurationPipeline], Awaitable[T]]) -> T:
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

    return run(_action)


class _StatusProgress:
    """Streams pipeline progress into a Streamlit status panel so a run shows what
    it is waiting on instead of a bare spinner: the panel label tracks the stage
    that just started, and every event is appended as a line."""

    def __init__(self, status: StatusContainer) -> None:
        self._status = status

    def on_progress(self, event: ProgressEvent) -> None:
        if event.phase is ProgressPhase.START:
            self._status.update(label=event.detail)
        self._status.write(event.detail)


def run_query(query: SavedQuery, principal: Principal) -> None:
    with st.status("Running pipeline…", expanded=True, type="compact") as status:
        listener = _StatusProgress(status)
        try:
            ranked = run(
                lambda _storage, pipeline: pipeline.run(query.id, principal, on_progress=listener)
            )
        except NotImplementedError as exc:
            status.update(label="Pipeline reached an unconfigured stage", state="error")
            st.info(f"Pipeline reached an unconfigured stage (wire the relevant extra): {exc}")
            return
        except (NotOwnerError, UnknownSavedQueryError) as exc:
            status.update(label="Run failed", state="error")
            st.error(str(exc))
            return
        status.update(label=f"Run complete - {len(ranked)} ranked result(s)", state="complete")
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


def _console_blocked_reason() -> str | None:
    config = get_config()
    if config.auth.scheme is not AuthScheme.LOCAL:
        return (
            f"The operator console is local-only; AUTH__SCHEME is "
            f"'{config.auth.scheme.value}'. Set it to 'local' to use this section."
        )
    if config.storage.db_path == IN_MEMORY_DB_PATH:
        return "STORAGE__DB_PATH is ':memory:'; the console needs a file-backed DB to persist."
    return None


def console_principal() -> Principal | None:
    """Gate shared by both console sections: refuse non-LOCAL/in-memory configs,
    then authenticate. Renders its own block/error message and returns None when
    the section can't run."""
    blocked = _console_blocked_reason()
    if blocked is not None:
        st.warning(blocked)
        return None
    principal = _authenticate()
    if principal is None:
        st.error("Authentication failed.")
        return None
    return principal
