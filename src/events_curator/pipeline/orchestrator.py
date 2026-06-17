"""The UI-agnostic curation pipeline: expand → search → merge → dedup → store →
rank, plus the feedback path. Every UI (Telegram bot, Streamlit, scheduler,
eval) drives the same object.

Ownership is enforced here: a principal may only run / give feedback on its own
saved queries. Preferences are read per saved query, so personalization is
scoped to the recurrent search, not the user.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass

from events_curator.auth import ensure_owner
from events_curator.dedup import Deduper
from events_curator.expand import Expander
from events_curator.feedback import PreferenceLearner
from events_curator.merge import Merger
from events_curator.models import (
    Feedback,
    PreferenceProfile,
    Principal,
    RankedSearchResult,
    SavedQueryId,
)
from events_curator.rank import Ranker
from events_curator.search import SearchEngine
from events_curator.storage import Storage


@dataclass(frozen=True)
class Stages:
    """The pluggable stage implementations a pipeline runs with."""

    expander: Expander
    search: SearchEngine
    merger: Merger
    deduper: Deduper
    ranker: Ranker
    learner: PreferenceLearner


class UnknownSavedQueryError(LookupError):
    """Raised when a run/feedback targets a saved query that does not exist."""


class CurationPipeline:
    def __init__(self, stages: Stages, storage: Storage) -> None:
        self._stages = stages
        self._storage = storage

    async def run(
        self, saved_query_id: SavedQueryId, principal: Principal
    ) -> list[RankedSearchResult]:
        query = await self._storage.queries.get(saved_query_id)
        if query is None:
            raise UnknownSavedQueryError(saved_query_id)
        ensure_owner(principal, query)

        expanded = await self._stages.expander.expand(query)
        # Rule 5: every expanded query is searched concurrently.
        per_query = await asyncio.gather(*[self._stages.search.search(q) for q in expanded.queries])
        merged = self._stages.merger.merge(per_query)
        await self._storage.results.add_raw(merged)

        outcomes = await self._stages.deduper.reconcile(merged, self._storage.results)
        canonical_ids = [
            o.canonical_search_result_id
            for o in outcomes
            if o.canonical_search_result_id is not None
        ]
        await self._storage.results.link_results(query.id, canonical_ids)

        results = await self._storage.results.results_for_query(query.id)
        profile = await self._storage.preferences.get(query.id) or PreferenceProfile(
            saved_query_id=query.id
        )
        return await self._stages.ranker.rank(results, profile, query=query)

    async def record_feedback(self, feedback: Feedback, principal: Principal) -> PreferenceProfile:
        query = await self._storage.queries.get(feedback.saved_query_id)
        if query is None:
            raise UnknownSavedQueryError(feedback.saved_query_id)
        ensure_owner(principal, query)
        return await self._stages.learner.record(
            feedback,
            feedback_store=self._storage.feedback,
            preference_store=self._storage.preferences,
        )
