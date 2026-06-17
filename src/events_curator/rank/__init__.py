"""Rank stage: order canonical results for one saved query, given its preference
profile.

Design (real impl, later): a cheap always-on embedding taste-vector prefilter
(cosine to the profile's liked-minus-disliked centroids), then an LLM reranker fed the
profile's natural-language summary; a logistic-regression blender is added once
feedback crosses the label threshold, plus a couple of exploration slots.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from events_curator.models import (
    CanonicalSearchResult,
    PreferenceProfile,
    RankedSearchResult,
    SavedQuery,
)


class Ranker(Protocol):
    async def rank(
        self,
        results: Sequence[CanonicalSearchResult],
        profile: PreferenceProfile,
        *,
        query: SavedQuery,
    ) -> list[RankedSearchResult]: ...


class PreferenceRanker:
    """STUB for the taste-vector + LLM-reranker design above. Needs an Embedder
    and an LLMClient wired in; raises until then."""

    async def rank(
        self,
        results: Sequence[CanonicalSearchResult],
        profile: PreferenceProfile,
        *,
        query: SavedQuery,
    ) -> list[RankedSearchResult]:
        del results, profile, query
        raise NotImplementedError("PreferenceRanker is a stub; wire an embedder + LLM reranker.")


__all__ = ["PreferenceRanker", "Ranker"]
