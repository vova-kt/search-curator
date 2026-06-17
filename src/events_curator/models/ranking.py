"""Ranking output, user feedback, and the per-saved-query preference profile."""

from __future__ import annotations

from datetime import UTC, datetime

from pydantic import BaseModel, Field

from events_curator.enums import FeedbackKind
from events_curator.models.ids import (
    CanonicalSearchResultId,
    FeedbackId,
    SavedQueryId,
    Vector,
    new_feedback_id,
)


def _now() -> datetime:
    return datetime.now(tz=UTC)


class RankedSearchResult(BaseModel):
    canonical_search_result_id: CanonicalSearchResultId
    score: float
    rank: int
    rationale: str | None = None  # short natural-language "why this rank"
    is_exploration: bool = False  # filled an exploration slot, not earned by score


class Feedback(BaseModel):
    id: FeedbackId = Field(default_factory=new_feedback_id)
    saved_query_id: SavedQueryId
    canonical_search_result_id: CanonicalSearchResultId
    kind: FeedbackKind
    reason: str | None = None  # free-text "why", esp. for dislikes
    created_at: datetime = Field(default_factory=_now)


class PreferenceProfile(BaseModel):
    """What we've learned about one saved query's taste.

    The natural-language summary feeds the LLM reranker; the centroids are the
    cheap always-on embedding signal. Both are updated from feedback.
    """

    saved_query_id: SavedQueryId
    nl_summary: str = ""
    liked_centroid: Vector | None = None
    disliked_centroid: Vector | None = None
    like_count: int = 0
    dislike_count: int = 0
    updated_at: datetime = Field(default_factory=_now)

    @property
    def label_count(self) -> int:
        return self.like_count + self.dislike_count
