"""Per-run bookkeeping for the deduper: the canonicals in play this run and the
ambiguous candidates held back for the batched judge. Kept apart from the
orchestration in ``__init__.py`` so each piece stays small and focused."""

from __future__ import annotations

from dataclasses import dataclass, field

from events_curator.models import (
    CanonicalSearchResult,
    CanonicalSearchResultId,
    Provenance,
    RawSearchResult,
    Vector,
)


@dataclass
class RunState:
    """The canonicals in play this run: the corpus seen so far plus what we create,
    indexed for exact-URL short-circuit and provenance accumulation."""

    url_index: dict[str, CanonicalSearchResultId] = field(
        default_factory=dict[str, CanonicalSearchResultId]
    )
    by_id: dict[CanonicalSearchResultId, CanonicalSearchResult] = field(
        default_factory=dict[CanonicalSearchResultId, CanonicalSearchResult]
    )
    provenance: dict[CanonicalSearchResultId, Provenance] = field(
        default_factory=dict[CanonicalSearchResultId, Provenance]
    )

    def remember(self, canonical: CanonicalSearchResult, provenance: Provenance) -> None:
        self.by_id[canonical.id] = canonical
        self.provenance[canonical.id] = provenance
        self.url_index[canonical.url] = canonical.id


@dataclass
class Pending:
    """An ambiguous candidate held back from the sequential pass for the batched
    judge: it matched `target_id` in the tiebreak band or on venue+time, but
    neither is conclusive, so the merge/insert is decided once the whole run's
    pairs are judged together."""

    index: int  # position in the candidate list, so the outcome lands in order
    candidate: RawSearchResult
    vector: Vector
    target_id: CanonicalSearchResultId
    similarity: float
