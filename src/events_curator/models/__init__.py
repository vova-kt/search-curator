"""Domain models — the shared vocabulary every stage speaks. Leaf module: it
depends only on `enums`, never on a stage."""

from __future__ import annotations

from events_curator.models.core import (
    ExpandedQuery,
    ExpandedQuerySet,
    GeoBias,
    Principal,
    SavedQuery,
    TimeWindow,
    User,
)
from events_curator.models.ids import (
    CanonicalSearchResultId,
    ExpandedQueryId,
    FeedbackId,
    RawSearchResultId,
    SavedQueryId,
    UserId,
    Vector,
    new_canonical_search_result_id,
    new_expanded_query_id,
    new_feedback_id,
    new_raw_search_result_id,
    new_saved_query_id,
    new_user_id,
)
from events_curator.models.ranking import Feedback, PreferenceProfile, RankedSearchResult
from events_curator.models.search_results import (
    CanonicalSearchResult,
    DedupOutcome,
    Geo,
    Provenance,
    RawSearchResult,
)

__all__ = [
    "CanonicalSearchResult",
    "CanonicalSearchResultId",
    "DedupOutcome",
    "ExpandedQuery",
    "ExpandedQueryId",
    "ExpandedQuerySet",
    "Feedback",
    "FeedbackId",
    "Geo",
    "GeoBias",
    "PreferenceProfile",
    "Principal",
    "Provenance",
    "RankedSearchResult",
    "RawSearchResult",
    "RawSearchResultId",
    "SavedQuery",
    "SavedQueryId",
    "TimeWindow",
    "User",
    "UserId",
    "Vector",
    "new_canonical_search_result_id",
    "new_expanded_query_id",
    "new_feedback_id",
    "new_raw_search_result_id",
    "new_saved_query_id",
    "new_user_id",
]
