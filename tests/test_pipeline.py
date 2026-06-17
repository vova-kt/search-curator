"""CurationPipeline wiring with typed fakes for the not-yet-real stages: a run
flows expand -> search -> merge -> dedup -> store -> rank, ownership is enforced,
unknown queries raise, and feedback is folded into the per-query profile."""

from __future__ import annotations

from collections.abc import Sequence

import pytest

from events_curator.auth import NotOwnerError
from events_curator.enums import (
    AuthScheme,
    DedupDecision,
    FeedbackKind,
    SearchEngineKind,
)
from events_curator.expand import IdentityExpander
from events_curator.merge import RRFMerger
from events_curator.models import (
    CanonicalSearchResult,
    DedupOutcome,
    ExpandedQuery,
    Feedback,
    PreferenceProfile,
    Principal,
    Provenance,
    RankedSearchResult,
    RawSearchResult,
    SavedQuery,
    UserId,
    new_canonical_search_result_id,
    new_saved_query_id,
)
from events_curator.pipeline import CurationPipeline, Stages, UnknownSavedQueryError
from events_curator.storage import (
    FeedbackStore,
    InMemoryStorage,
    PreferenceStore,
    SearchResultStore,
)


class FakeSearch:
    kind = SearchEngineKind.FRONTIER_NATIVE

    async def search(self, query: ExpandedQuery) -> list[RawSearchResult]:
        return [
            RawSearchResult(
                source_query_id=query.id,
                source_engine=self.kind,
                url=f"https://e/{i}",
                title=f"result {i}",
                rank=i,
            )
            for i in range(2)
        ]


class FakeDeduper:
    """Inserts every candidate as its own canonical record (no merging)."""

    async def reconcile(
        self, candidates: Sequence[RawSearchResult], results: SearchResultStore
    ) -> list[DedupOutcome]:
        outcomes: list[DedupOutcome] = []
        for candidate in candidates:
            canonical = CanonicalSearchResult(
                id=new_canonical_search_result_id(),
                url=candidate.url,
                title=candidate.title,
                source_search_result_ids=[candidate.id],
            )
            await results.upsert_canonical(
                canonical, Provenance(canonical_search_result_id=canonical.id)
            )
            outcomes.append(
                DedupOutcome(
                    candidate=candidate,
                    decision=DedupDecision.INSERT_NEW,
                    canonical_search_result_id=canonical.id,
                )
            )
        return outcomes


class FakeRanker:
    async def rank(
        self,
        results: Sequence[CanonicalSearchResult],
        profile: PreferenceProfile,
        *,
        query: SavedQuery,
    ) -> list[RankedSearchResult]:
        del profile, query
        return [
            RankedSearchResult(
                canonical_search_result_id=ev.id, score=float(len(results) - i), rank=i
            )
            for i, ev in enumerate(results)
        ]


class FakeLearner:
    async def record(
        self,
        feedback: Feedback,
        *,
        feedback_store: FeedbackStore,
        preference_store: PreferenceStore,
    ) -> PreferenceProfile:
        await feedback_store.add(feedback)
        profile = await preference_store.get(feedback.saved_query_id) or PreferenceProfile(
            saved_query_id=feedback.saved_query_id
        )
        if feedback.kind is FeedbackKind.LIKE:
            profile.like_count += 1
        else:
            profile.dislike_count += 1
        await preference_store.upsert(profile)
        return profile


def _stages() -> Stages:
    return Stages(
        expander=IdentityExpander(),
        search=FakeSearch(),
        merger=RRFMerger(k=60),
        deduper=FakeDeduper(),
        ranker=FakeRanker(),
        learner=FakeLearner(),
    )


async def _pipeline_with_query(
    owner: UserId,
) -> tuple[CurationPipeline, SavedQuery, InMemoryStorage]:
    storage = InMemoryStorage()
    query = SavedQuery(user_id=owner, text="jazz in berlin")
    await storage.queries.upsert(query)
    return CurationPipeline(_stages(), storage), query, storage


def _principal(user_id: UserId) -> Principal:
    return Principal(user_id=user_id, scheme=AuthScheme.LOCAL)


async def test_run_returns_ranked_results() -> None:
    pipeline, query, _ = await _pipeline_with_query(UserId("u1"))
    ranked = await pipeline.run(query.id, _principal(UserId("u1")))

    assert len(ranked) == 2
    assert [r.rank for r in ranked] == [0, 1]


async def test_run_rejects_non_owner() -> None:
    pipeline, query, _ = await _pipeline_with_query(UserId("u1"))
    with pytest.raises(NotOwnerError):
        await pipeline.run(query.id, _principal(UserId("intruder")))


async def test_run_unknown_query() -> None:
    pipeline, _, _ = await _pipeline_with_query(UserId("u1"))
    with pytest.raises(UnknownSavedQueryError):
        await pipeline.run(new_saved_query_id(), _principal(UserId("u1")))


async def test_record_feedback_updates_profile() -> None:
    pipeline, query, storage = await _pipeline_with_query(UserId("u1"))
    feedback = Feedback(
        saved_query_id=query.id,
        canonical_search_result_id=new_canonical_search_result_id(),
        kind=FeedbackKind.LIKE,
    )
    profile = await pipeline.record_feedback(feedback, _principal(UserId("u1")))

    assert profile.like_count == 1
    stored = await storage.feedback.list_for_query(query.id)
    assert len(stored) == 1
