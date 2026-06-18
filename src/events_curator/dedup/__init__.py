"""Dedup stage: reconcile fresh candidates against the stored corpus, both within
this run and across past sessions.

Entity resolution in three parts (concept: ``docs/concepts/entity-resolution.md``)
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Protocol

from events_curator.dedup._golden import doc_text, merge_into, new_golden
from events_curator.dedup._judge import build_judge_prompt, parse_verdicts, submit_tool
from events_curator.dedup._match import (
    combined_similarity,
    jaccard,
    text_signature,
    venue_time_match,
)
from events_curator.dedup._state import Pending, RunState
from events_curator.embed import Embedder
from events_curator.enums import DedupDecision, Stage
from events_curator.llm import LLMClient
from events_curator.models import (
    CanonicalSearchResult,
    CanonicalSearchResultId,
    DedupOutcome,
    Provenance,
    RawSearchResult,
    Vector,
)
from events_curator.storage import SearchResultStore

_LOG = logging.getLogger(f"events_curator.stage.{Stage.DEDUP.value}")


class Deduper(Protocol):
    async def reconcile(
        self, candidates: Sequence[RawSearchResult], results: SearchResultStore
    ) -> list[DedupOutcome]:
        """Reconcile candidates against the stored corpus.

        Contract: upserts the resulting canonical results into `results` and
        returns one outcome per candidate with `canonical_search_result_id` set to
        the canonical record it landed in (new or existing).
        """
        ...


class ThresholdDeduper(Deduper):
    """Blocking + two-threshold similarity with a batched LLM tiebreak judge. A
    sequential pass settles the unambiguous candidates inline and holds the
    ambiguous ones (tiebreak-band similarity *or* a venue+start-time match) back;
    one `submit_verdicts` call then judges every held-back pair together. Drives an
    `Embedder` (semantic signal) and an `LLMClient` (the judge)."""

    def __init__(
        self,
        embedder: Embedder,
        judge: LLMClient,
        *,
        system_prompt: str,
        model: str,
        temperature: float = 0.0,
        auto_merge_threshold: float = 0.88,
        tiebreak_low_threshold: float = 0.75,
        block_window_days: int = 1,
        block_limit: int = 10,
    ) -> None:
        self._embedder = embedder
        self._judge = judge
        self._system_prompt = system_prompt
        self._model = model
        self._temperature = temperature
        self._auto_merge_threshold = auto_merge_threshold
        self._tiebreak_low_threshold = tiebreak_low_threshold
        self._block_window_days = block_window_days
        self._block_limit = block_limit

    async def reconcile(
        self, candidates: Sequence[RawSearchResult], results: SearchResultStore
    ) -> list[DedupOutcome]:
        if not candidates:
            _LOG.debug("reconcile called with no candidates; nothing to do")
            return []
        _LOG.debug("reconciling %d candidate(s) against the corpus", len(candidates))
        # Rule 5: all candidate embeddings are known up front -> one batched call.
        vectors = await self._embedder.embed([doc_text(c) for c in candidates])
        state = RunState()
        # Pass 1: settle the unambiguous candidates inline (so later ones can match
        # them within the run); hold ambiguous pairs back for one batched judge call.
        outcomes: list[DedupOutcome | None] = [None] * len(candidates)
        pending: list[Pending] = []
        for index, (candidate, vector) in enumerate(zip(candidates, vectors, strict=True)):
            outcomes[index] = await self._triage(index, candidate, vector, results, state, pending)
        # Pass 2: judge every held-back pair together, then apply the verdicts.
        if pending:
            await self._resolve_pending(pending, results, state, outcomes)
        resolved = [o for o in outcomes if o is not None]
        _LOG.debug(
            "reconcile done: %d outcome(s) across %d canonical(s)",
            len(resolved),
            len(state.by_id),
        )
        return resolved

    async def _triage(
        self,
        index: int,
        candidate: RawSearchResult,
        vector: Vector,
        results: SearchResultStore,
        state: RunState,
        pending: list[Pending],
    ) -> DedupOutcome | None:
        """Decide a candidate's deterministic fate, or hold it for the batched judge.
        Returns the outcome for an inline decision, or ``None`` after queueing a
        `Pending` (its outcome is filled in by `_resolve_pending`)."""
        same_url = state.url_index.get(candidate.url)
        if same_url is not None:
            _LOG.debug("_triage: exact-URL hit for %s -> merging into %s", candidate.url, same_url)
            return await self._merge(candidate, results, state, state.by_id[same_url], 1.0)

        match = await self._best_match(candidate, vector, results)
        if match is None:
            _LOG.debug("_triage: no block match for %s -> inserting new", candidate.url)
            return await self._insert(candidate, vector, results, state, similarity=None)
        target, sim, venue_time = match
        if sim >= self._auto_merge_threshold:
            _LOG.debug(
                "_triage: auto-merge %s into %s (sim=%.3f >= %.3f)",
                candidate.url,
                target.id,
                sim,
                self._auto_merge_threshold,
            )
            return await self._merge(candidate, results, state, target, sim)
        if sim >= self._tiebreak_low_threshold or venue_time:
            _LOG.debug(
                "_triage: ambiguous %s vs %s (sim=%.3f, venue_time=%s); deferring to judge",
                candidate.url,
                target.id,
                sim,
                venue_time,
            )
            pending.append(
                Pending(
                    index=index,
                    candidate=candidate,
                    vector=vector,
                    target_id=target.id,
                    similarity=sim,
                )
            )
            return None
        _LOG.debug(
            "_triage: below tiebreak band for %s (sim=%.3f < %.3f) -> inserting new",
            candidate.url,
            sim,
            self._tiebreak_low_threshold,
        )
        return await self._insert(candidate, vector, results, state, similarity=sim)

    async def _resolve_pending(
        self,
        pending: list[Pending],
        results: SearchResultStore,
        state: RunState,
        outcomes: list[DedupOutcome | None],
    ) -> None:
        """Judge all held-back pairs in one call, then merge the affirmed pairs and
        insert the rest. Targets are re-resolved at apply time so a same-target run
        of merges folds into the latest record rather than a stale snapshot."""
        judged: list[tuple[Pending, CanonicalSearchResult]] = []
        for p in pending:
            target = await self._resolve(p.target_id, results, state)
            if target is None:  # defensive: the corpus target vanished -> insert new
                outcomes[p.index] = await self._insert_pending(p, results, state)
            else:
                judged.append((p, target))
        if not judged:
            return
        prompt = build_judge_prompt(self._system_prompt, [(p.candidate, t) for p, t in judged])
        arguments = await self._judge.submit(
            prompt, tool=submit_tool(), model=self._model, temperature=self._temperature
        )
        verdicts = parse_verdicts(arguments, count=len(judged))
        merges = sum(verdicts.values())
        _LOG.info("dedup judge ruled %d/%d held-back pair(s) duplicate", merges, len(judged))
        for offset, (p, _) in enumerate(judged):
            target = await self._resolve(p.target_id, results, state)
            if verdicts.get(offset, False) and target is not None:
                outcomes[p.index] = await self._merge(
                    p.candidate, results, state, target, p.similarity, DedupDecision.TIEBREAK
                )
            else:
                outcomes[p.index] = await self._insert_pending(p, results, state)

    async def _insert_pending(
        self, p: Pending, results: SearchResultStore, state: RunState
    ) -> DedupOutcome:
        return await self._insert(
            p.candidate,
            p.vector,
            results,
            state,
            similarity=p.similarity,
            decision=DedupDecision.TIEBREAK,
        )

    async def _resolve(
        self, target_id: CanonicalSearchResultId, results: SearchResultStore, state: RunState
    ) -> CanonicalSearchResult | None:
        """The current canonical for an id: prefer this run's copy (it may have been
        updated by an earlier merge) and fall back to the stored corpus."""
        return state.by_id.get(target_id) or await results.get_canonical(target_id)

    async def _best_match(
        self, candidate: RawSearchResult, vector: Vector, results: SearchResultStore
    ) -> tuple[CanonicalSearchResult, float, bool] | None:
        """The block member that is the strongest duplicate candidate, as
        ``(target, text_similarity, venue_time_match)``. Ranked by decision tier
        first (auto-merge > judge > insert) then by text similarity, so a strong
        textual match wins over a venue+time-only match — the latter is mere
        evidence for the judge, not grounds to auto-merge."""
        matches = await results.nearest(
            vector,
            on_date=candidate.starts_at,
            within_days=self._block_window_days,
            city=candidate.geo.city,
            limit=self._block_limit,
        )
        if not matches:
            return None  # block empty; _triage logs the resulting insert
        signature = text_signature(doc_text(candidate))
        best: tuple[CanonicalSearchResult, float, bool] | None = None
        best_key: tuple[int, float] | None = None
        for other, cosine in matches:
            sim = combined_similarity(cosine, jaccard(signature, text_signature(doc_text(other))))
            venue_time = venue_time_match(
                candidate.geo.venue, candidate.starts_at, other.geo.venue, other.starts_at
            )
            key = (self._tier(sim, venue_time), sim)
            if best_key is None or key > best_key:
                best, best_key = (other, sim, venue_time), key
        return best

    def _tier(self, similarity: float, venue_time: bool) -> int:
        """The decision tier for a candidate match: 2 auto-merge, 1 judge, 0 insert."""
        if similarity >= self._auto_merge_threshold:
            return 2
        if similarity >= self._tiebreak_low_threshold or venue_time:
            return 1
        return 0

    async def _merge(
        self,
        candidate: RawSearchResult,
        results: SearchResultStore,
        state: RunState,
        target: CanonicalSearchResult,
        similarity: float,
        decision: DedupDecision = DedupDecision.AUTO_MERGE,
    ) -> DedupOutcome:
        prior = state.provenance.get(target.id) or Provenance(canonical_search_result_id=target.id)
        merged, provenance = merge_into(target, prior, candidate)
        await results.upsert_canonical(merged, provenance)
        state.remember(merged, provenance)
        state.url_index[candidate.url] = merged.id
        return DedupOutcome(
            candidate=candidate,
            decision=decision,
            canonical_search_result_id=merged.id,
            similarity=similarity,
        )

    async def _insert(
        self,
        candidate: RawSearchResult,
        vector: Vector,
        results: SearchResultStore,
        state: RunState,
        *,
        similarity: float | None,
        decision: DedupDecision = DedupDecision.INSERT_NEW,
    ) -> DedupOutcome:
        canonical, provenance = new_golden(candidate, vector)
        await results.upsert_canonical(canonical, provenance)
        state.remember(canonical, provenance)
        return DedupOutcome(
            candidate=candidate,
            decision=decision,
            canonical_search_result_id=canonical.id,
            similarity=similarity,
        )


__all__ = ["Deduper", "ThresholdDeduper"]
