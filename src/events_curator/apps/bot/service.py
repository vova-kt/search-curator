"""The transport-neutral assistant core. One object that a chat frontend drives:
it authorizes a chat, runs the new-search dialogue, persists/lists/deletes saved
searches, executes runs (manual and scheduled), and records feedback — all behind
plain methods that speak domain types, never frames of any particular chat API.

Ownership and the per-user "don't repeat" guarantee are enforced through the
pipeline (`unseen_only=True` on delivery runs); this layer only caps each run to
the saved query's `max_results_shown` and marks exactly the delivered results as
shown. Manual runs do not advance the schedule; scheduled runs do.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Sequence
from datetime import datetime

from events_curator.apps.bot.schedule import is_due, is_valid_cron, now_utc
from events_curator.apps.bot.types import Delivery, DeliveryBatch
from events_curator.auth import Authenticator, ensure_owner
from events_curator.enums import AuthScheme, FeedbackKind
from events_curator.llm import ChatMessage
from events_curator.models import (
    CanonicalSearchResultId,
    Feedback,
    Principal,
    SavedQuery,
    SavedQueryId,
    User,
)
from events_curator.pipeline import CurationPipeline, ProgressListener, UnknownSavedQueryError
from events_curator.search_builder import BuilderTurn, SearchBuilder, SearchDraft
from events_curator.storage import Storage

_LOG = logging.getLogger("events_curator.apps.bot")


class InvalidScheduleError(ValueError):
    """Raised when a draft carries a schedule that isn't a valid 5-field cron."""


class AssistantService:
    def __init__(
        self,
        *,
        pipeline: CurationPipeline,
        storage: Storage,
        authenticator: Authenticator,
        builder: SearchBuilder,
        owner_id: str,
    ) -> None:
        self._pipeline = pipeline
        self._storage = storage
        self._auth = authenticator
        self._builder = builder
        self._owner_id = owner_id.strip()

    # -- access control -------------------------------------------------------
    async def authorize(self, credential: str) -> Principal | None:
        """Authenticate a chat and return its principal *only* if it's the owner;
        any other chat returns None (the frontend notifies the owner). On first
        sight of the owner, the backing `User` row is created."""
        if not self._owner_id or credential.strip() != self._owner_id:
            return None
        principal = await self._auth.authenticate(credential)
        if principal is None:
            return None
        await self._ensure_user(principal)
        return principal

    async def _ensure_user(self, principal: Principal) -> None:
        if await self._storage.users.get(principal.user_id) is None:
            await self._storage.users.upsert(
                User(id=principal.user_id, display_name=principal.display_name)
            )

    # -- new-search dialogue --------------------------------------------------
    async def build_turn(self, conversation: Sequence[ChatMessage]) -> BuilderTurn:
        """Advance the new-search dialogue by one turn (see `search_builder`)."""
        return await self._builder.advance(conversation)

    async def save_search(self, principal: Principal, draft: SearchDraft) -> SavedQuery:
        cron = (draft.schedule_cron or "").strip() or None
        if cron is not None and not is_valid_cron(cron):
            raise InvalidScheduleError(cron)
        query = SavedQuery(
            user_id=principal.user_id,
            text=draft.text,
            city=draft.city,
            schedule_cron=cron,
            schedule_text=draft.schedule_text,
            max_results_shown=draft.max_results_shown,
        )
        await self._storage.queries.upsert(query)
        _LOG.info("saved query %s for %s (cron=%s)", query.id, principal.user_id, cron)
        return query

    # -- saved-search management ---------------------------------------------
    async def list_searches(self, principal: Principal) -> list[SavedQuery]:
        return await self._storage.queries.list_for_user(principal.user_id)

    async def delete_search(self, principal: Principal, query_id: SavedQueryId) -> None:
        query = await self._storage.queries.get(query_id)
        if query is None:
            raise UnknownSavedQueryError(query_id)
        ensure_owner(principal, query)
        await self._storage.queries.delete(query_id)
        _LOG.info("deleted query %s", query_id)

    # -- runs -----------------------------------------------------------------
    async def run_now(
        self,
        principal: Principal,
        query_id: SavedQueryId,
        *,
        on_progress: ProgressListener | None = None,
    ) -> list[Delivery]:
        """Execute a saved search immediately and return the capped, now-marked-shown
        deliveries. Does not advance the schedule (manual runs are off-cycle)."""
        ranked = await self._pipeline.run(
            query_id, principal, unseen_only=True, on_progress=on_progress
        )
        query = await self._storage.queries.get(query_id)
        assert query is not None  # pipeline.run would have raised otherwise
        deliveries = await self._deliver(query, [r.canonical_search_result_id for r in ranked])
        _LOG.info("manual run of %s delivered %d", query_id, len(deliveries))
        return deliveries

    async def run_due(self, now: datetime | None = None) -> list[DeliveryBatch]:
        """Run every enabled, scheduled, due saved query concurrently and return one
        delivery batch per query (empty batches included so callers can log them).
        Advances each run query's `last_run_at`."""
        moment = now or now_utc()
        scheduled = await self._storage.queries.list_scheduled()
        due = [
            q
            for q in scheduled
            if q.schedule_cron is not None
            and is_due(q.schedule_cron, q.last_run_at or q.created_at, moment)
        ]
        if not due:
            return []
        _LOG.info("scheduler: %d of %d scheduled query(ies) due", len(due), len(scheduled))
        return list(await asyncio.gather(*[self._run_scheduled(q.id, moment) for q in due]))

    async def _run_scheduled(self, query_id: SavedQueryId, moment: datetime) -> DeliveryBatch:
        query = await self._storage.queries.get(query_id)
        assert query is not None
        principal = Principal(user_id=query.user_id, scheme=AuthScheme.TELEGRAM)
        ranked = await self._pipeline.run(query_id, principal, unseen_only=True)
        deliveries = await self._deliver(query, [r.canonical_search_result_id for r in ranked])
        # Re-fetch: pipeline.run caches the derived domain by upserting the query, so
        # set last_run_at on the fresh copy to avoid clobbering that write.
        fresh = await self._storage.queries.get(query_id)
        if fresh is not None:
            fresh.last_run_at = moment
            await self._storage.queries.upsert(fresh)
        return DeliveryBatch(user_id=query.user_id, deliveries=deliveries)

    async def _deliver(
        self, query: SavedQuery, ranked_ids: Sequence[CanonicalSearchResultId]
    ) -> list[Delivery]:
        capped = list(ranked_ids)[: query.max_results_shown]
        deliveries: list[Delivery] = []
        for cid in capped:
            result = await self._storage.results.get_canonical(cid)
            if result is not None:
                deliveries.append(
                    Delivery(saved_query_id=query.id, domain=query.domain, result=result)
                )
        if deliveries:
            await self._storage.results.mark_shown(query.user_id, [d.result.id for d in deliveries])
        return deliveries

    # -- feedback -------------------------------------------------------------
    async def record_feedback(
        self,
        principal: Principal,
        saved_query_id: SavedQueryId,
        result_id: CanonicalSearchResultId,
        kind: FeedbackKind,
        reason: str | None = None,
    ) -> None:
        feedback = Feedback(
            saved_query_id=saved_query_id,
            canonical_search_result_id=result_id,
            kind=kind,
            reason=reason,
        )
        await self._pipeline.record_feedback(feedback, principal)
