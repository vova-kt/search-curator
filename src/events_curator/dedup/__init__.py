"""Dedup stage: reconcile fresh candidates against the stored corpus, both
within this run and across past sessions.

Pipeline (real impl, later): URL-canonicalize → block on date(±N days)+city →
MinHash/embedding cosine. similarity ≥ auto_merge → merge; in the tiebreak band
→ ask the LLM judge; else insert new. Merged records build a golden record by
survivorship, keeping provenance. The store's `nearest` does the cross-session
lookup, so dedup depends only on the SearchResultStore read side.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from events_curator.models import DedupOutcome, RawSearchResult
from events_curator.storage import SearchResultStore


class Deduper(Protocol):
    async def reconcile(
        self, candidates: Sequence[RawSearchResult], results: SearchResultStore
    ) -> list[DedupOutcome]:
        """Reconcile candidates against the stored corpus.

        Contract: upserts the resulting canonical results into `results` and
        returns one outcome per candidate with `canonical_search_result_id` set to the
        canonical record it landed in (new or existing).
        """
        ...


class ThresholdDeduper:
    """STUB for the blocking + threshold + tiebreak design above. Needs an
    Embedder and an LLMClient wired in; raises until then."""

    async def reconcile(
        self, candidates: Sequence[RawSearchResult], results: SearchResultStore
    ) -> list[DedupOutcome]:
        del candidates, results
        raise NotImplementedError("ThresholdDeduper is a stub; wire an embedder + LLM judge.")


__all__ = ["Deduper", "ThresholdDeduper"]
