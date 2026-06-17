"""Distinct id types so the type checker stops you mixing, say, a user id and a
search-result id. They are plain strings at runtime."""

from __future__ import annotations

from typing import NewType
from uuid import uuid4

UserId = NewType("UserId", str)
SavedQueryId = NewType("SavedQueryId", str)
ExpandedQueryId = NewType("ExpandedQueryId", str)
RawSearchResultId = NewType("RawSearchResultId", str)
CanonicalSearchResultId = NewType("CanonicalSearchResultId", str)
FeedbackId = NewType("FeedbackId", str)

# A dense embedding. Length is fixed by EmbeddingSettings.dimensions.
Vector = list[float]


def _fresh() -> str:
    return uuid4().hex


def new_user_id() -> UserId:
    return UserId(_fresh())


def new_saved_query_id() -> SavedQueryId:
    return SavedQueryId(_fresh())


def new_expanded_query_id() -> ExpandedQueryId:
    return ExpandedQueryId(_fresh())


def new_raw_search_result_id() -> RawSearchResultId:
    return RawSearchResultId(_fresh())


def new_canonical_search_result_id() -> CanonicalSearchResultId:
    return CanonicalSearchResultId(_fresh())


def new_feedback_id() -> FeedbackId:
    return FeedbackId(_fresh())
