"""Merge stage: fuse the per-expanded-query result lists into one ranking.

Reciprocal Rank Fusion (RRF): an item's fused score is the sum over lists of
1/(k + rank). It's parameter-light, needs no score calibration across engines,
and is robust — the standard choice for combining fan-out results. This stage is
pure (no I/O), so it's a real implementation, not a stub.

Fusion keys on `RawSearchResult.rank` — the field whose stated purpose is the
list position for RRF — rather than the slot the item happens to occupy in the
sequence handed in, so a caller may pass lists in any order without changing the
result. Items are fused by canonical `url`; the representative kept for a url is
its best-ranked (lowest `rank`) sighting.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from events_curator.models import RawSearchResult


class Merger(Protocol):
    def merge(self, ranked_lists: Sequence[Sequence[RawSearchResult]]) -> list[RawSearchResult]: ...


class RRFMerger:
    def __init__(self, k: int = 60) -> None:
        self._k = k

    def merge(self, ranked_lists: Sequence[Sequence[RawSearchResult]]) -> list[RawSearchResult]:
        scores: dict[str, float] = {}
        representative: dict[str, RawSearchResult] = {}
        for ranked in ranked_lists:
            for result in ranked:
                key = result.url
                scores[key] = scores.get(key, 0.0) + 1.0 / (self._k + result.rank + 1)
                chosen = representative.get(key)
                if chosen is None or result.rank < chosen.rank:
                    representative[key] = result
        return sorted(representative.values(), key=lambda e: scores[e.url], reverse=True)


__all__ = ["Merger", "RRFMerger"]
