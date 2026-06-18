"""ProfileUpdater folds a like/dislike into the per-query profile: it advances the
matching taste centroid by an incremental mean, regenerates the NL summary via the
LLM, appends the feedback, and reuses the result's stored embedding. Plus the
dependency-free helpers: the centroid math and the summary prompt/parse contract."""

from __future__ import annotations

from collections.abc import Sequence

import pytest

from events_curator.enums import FeedbackKind
from events_curator.feedback import ProfileUpdater, UnknownResultError
from events_curator.feedback._centroid import fold_feedback
from events_curator.feedback._summary import build_summary_prompt, parse_summary
from events_curator.models import (
    CanonicalSearchResult,
    Feedback,
    Geo,
    PreferenceProfile,
    Provenance,
    SavedQueryId,
    Vector,
)
from events_curator.storage import InMemoryStorage


class FakeEmbedder:
    def __init__(self, by_title: dict[str, Vector]) -> None:
        self._by_title = by_title
        self.calls = 0

    async def embed(self, texts: Sequence[str]) -> list[Vector]:
        self.calls += 1
        return [self._by_title[text.split("\n", 1)[0]] for text in texts]


class FakeSummarizer:
    def __init__(self, reply: str) -> None:
        self._reply = reply
        self.calls = 0

    async def complete(self, messages: object, *, model: str, temperature: float = 0.0) -> str:
        del messages, model, temperature
        self.calls += 1
        return self._reply

    async def submit(
        self, messages: object, *, tool: object, model: str, temperature: float = 0.0
    ) -> str:
        del messages, tool, model, temperature
        raise NotImplementedError  # the summarizer answers via complete only


QID = SavedQueryId("q1")


def _result(title: str, *, embedding: Vector | None = None) -> CanonicalSearchResult:
    return CanonicalSearchResult(url=f"https://e.com/{title}", title=title, embedding=embedding)


def _feedback(result_id: str, kind: FeedbackKind, *, reason: str | None = None) -> Feedback:
    return Feedback(
        saved_query_id=QID,
        canonical_search_result_id=result_id,  # type: ignore[arg-type]
        kind=kind,
        reason=reason,
    )


# --- _centroid -------------------------------------------------------------


def test_fold_first_like_seeds_centroid() -> None:
    profile = PreferenceProfile(saved_query_id=QID)
    updated = fold_feedback(profile, FeedbackKind.LIKE, [1.0, 0.0], "likes jazz")

    assert updated.liked_centroid == [1.0, 0.0]
    assert updated.like_count == 1
    assert updated.nl_summary == "likes jazz"
    assert updated.disliked_centroid is None


def test_fold_second_like_averages_incrementally() -> None:
    profile = PreferenceProfile(saved_query_id=QID, liked_centroid=[1.0, 0.0], like_count=1)
    updated = fold_feedback(profile, FeedbackKind.LIKE, [0.0, 2.0], "summary")

    assert updated.liked_centroid == [0.5, 1.0]  # mean of [1,0] and [0,2]
    assert updated.like_count == 2


def test_fold_dislike_updates_disliked_side_only() -> None:
    profile = PreferenceProfile(saved_query_id=QID, liked_centroid=[1.0, 0.0], like_count=1)
    updated = fold_feedback(profile, FeedbackKind.DISLIKE, [0.0, 1.0], "summary")

    assert updated.disliked_centroid == [0.0, 1.0]
    assert updated.dislike_count == 1
    assert updated.liked_centroid == [1.0, 0.0]  # untouched
    assert updated.like_count == 1


# --- _summary --------------------------------------------------------------


def test_build_summary_prompt_carries_current_summary_reason_and_item() -> None:
    result = _result("Tribute Night").model_copy(update={"geo": Geo(city="Berlin")})
    feedback = _feedback(result.id, FeedbackKind.DISLIKE, reason="no tribute acts")
    messages = build_summary_prompt("be a summarizer", "likes small venues", feedback, result)

    assert [m.role for m in messages] == ["system", "user"]
    assert messages[0].content == "be a summarizer"
    body = messages[1].content
    assert "likes small venues" in body
    assert "DISLIKED" in body
    assert "Tribute Night" in body
    assert "no tribute acts" in body


def test_parse_summary_trims() -> None:
    assert parse_summary("  prefers small venues  \n") == "prefers small venues"


# --- ProfileUpdater --------------------------------------------------------


async def _store_with(result: CanonicalSearchResult) -> InMemoryStorage:
    storage = InMemoryStorage()
    await storage.results.upsert_canonical(result, Provenance(canonical_search_result_id=result.id))
    return storage


async def _record(
    storage: InMemoryStorage, feedback: Feedback, embedder: FakeEmbedder, summarizer: FakeSummarizer
) -> PreferenceProfile:
    return await ProfileUpdater(
        embedder, summarizer, system_prompt="summarize", model="test-model"
    ).record(
        feedback,
        feedback_store=storage.feedback,
        preference_store=storage.preferences,
        result_store=storage.results,
    )


async def test_record_like_updates_profile_and_persists() -> None:
    result = _result("Jazz Night", embedding=[1.0, 0.0])
    storage = await _store_with(result)
    embedder, summarizer = FakeEmbedder({}), FakeSummarizer("likes jazz")
    profile = await _record(storage, _feedback(result.id, FeedbackKind.LIKE), embedder, summarizer)

    assert profile.liked_centroid == [1.0, 0.0]
    assert profile.like_count == 1
    assert profile.nl_summary == "likes jazz"
    assert embedder.calls == 0  # stored embedding reused
    assert summarizer.calls == 1
    stored = await storage.preferences.get(QID)
    assert stored is not None
    assert stored.like_count == 1
    assert len(await storage.feedback.list_for_query(QID)) == 1


async def test_record_embeds_result_lacking_an_embedding() -> None:
    result = _result("Folk Set")  # no stored embedding
    storage = await _store_with(result)
    embedder = FakeEmbedder({"Folk Set": [0.0, 1.0]})
    profile = await _record(
        storage, _feedback(result.id, FeedbackKind.LIKE), embedder, FakeSummarizer("s")
    )

    assert embedder.calls == 1
    assert profile.liked_centroid == [0.0, 1.0]


async def test_record_unknown_result_raises() -> None:
    storage = InMemoryStorage()
    with pytest.raises(UnknownResultError):
        await _record(
            storage, _feedback("missing", FeedbackKind.LIKE), FakeEmbedder({}), FakeSummarizer("s")
        )
    assert await storage.preferences.get(QID) is None
    assert len(await storage.feedback.list_for_query(QID)) == 0
