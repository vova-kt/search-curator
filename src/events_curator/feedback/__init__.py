"""Feedback stage: record a like/dislike and fold it into the saved query's
preference profile (design: ``docs/preferences.md``).

`ProfileUpdater` appends the feedback, then updates both learned signals together:
the natural-language summary (an LLM rewrite, ``_summary.py``) and the liked/
disliked taste centroids (an exact incremental mean, ``_centroid.py``). Both are
scoped to the saved query, so each recurring search learns its own taste. The
item's vector is its stored canonical embedding when present, otherwise embedded on
the fly; the embed and the summary LLM call are independent, so they're dispatched
concurrently (rule 5).
"""

from __future__ import annotations

import asyncio
from typing import Protocol

from events_curator.embed import Embedder
from events_curator.feedback._centroid import fold_feedback
from events_curator.feedback._summary import build_summary_prompt, parse_summary
from events_curator.llm import LLMClient
from events_curator.models import (
    CanonicalSearchResult,
    Feedback,
    PreferenceProfile,
    Vector,
)
from events_curator.storage import FeedbackStore, PreferenceStore, SearchResultStore


class PreferenceLearner(Protocol):
    async def record(
        self,
        feedback: Feedback,
        *,
        feedback_store: FeedbackStore,
        preference_store: PreferenceStore,
        result_store: SearchResultStore,
    ) -> PreferenceProfile: ...


class UnknownResultError(LookupError):
    """Raised when feedback targets a canonical result that isn't in the store."""


class ProfileUpdater:
    """Updates the NL summary (LLM) and taste centroids (embedder) from one label.
    Both adapters default to the Unconfigured placeholders in the builder, so a live
    run raises with a pointer to the `embed`/`llm` extra until real ones are wired."""

    def __init__(
        self,
        embedder: Embedder,
        summarizer: LLMClient,
        *,
        system_prompt: str,
        model: str,
        temperature: float = 0.0,
    ) -> None:
        self._embedder = embedder
        self._summarizer = summarizer
        self._system_prompt = system_prompt
        self._model = model
        self._temperature = temperature

    async def record(
        self,
        feedback: Feedback,
        *,
        feedback_store: FeedbackStore,
        preference_store: PreferenceStore,
        result_store: SearchResultStore,
    ) -> PreferenceProfile:
        result = await result_store.get_canonical(feedback.canonical_search_result_id)
        if result is None:
            raise UnknownResultError(feedback.canonical_search_result_id)
        await feedback_store.add(feedback)
        profile = await preference_store.get(feedback.saved_query_id) or PreferenceProfile(
            saved_query_id=feedback.saved_query_id
        )
        vector, summary = await asyncio.gather(
            self._vector_for(result),
            self._summarize(profile.nl_summary, feedback, result),
        )
        updated = fold_feedback(profile, feedback.kind, vector, summary)
        await preference_store.upsert(updated)
        return updated

    async def _vector_for(self, result: CanonicalSearchResult) -> Vector:
        if result.embedding is not None:
            return result.embedding
        [vector] = await self._embedder.embed([f"{result.title}\n{result.description}".strip()])
        return vector

    async def _summarize(
        self, current_summary: str, feedback: Feedback, result: CanonicalSearchResult
    ) -> str:
        prompt = build_summary_prompt(self._system_prompt, current_summary, feedback, result)
        reply = await self._summarizer.complete(
            prompt, model=self._model, temperature=self._temperature
        )
        return parse_summary(reply)


__all__ = ["PreferenceLearner", "ProfileUpdater", "UnknownResultError"]
