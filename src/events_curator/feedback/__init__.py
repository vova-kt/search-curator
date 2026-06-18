"""Feedback stage: record a like/dislike and fold it into the saved query's
preference profile (design: ``docs/preferences.md``).

`ProfileUpdater` appends the feedback, then updates both learned signals together:
the natural-language summary (an LLM rewrite, ``_summary.py``) and the liked/
disliked taste centroids (an exact incremental mean, ``_centroid.py``). Both are
scoped to the saved query.
"""

from __future__ import annotations

import asyncio
import logging
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

_LOG = logging.getLogger("events_curator.stage.feedback")


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


class ProfileUpdater(PreferenceLearner):
    """Updates the NL summary (LLM) and taste centroids (embedder) from one label."""

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
        _LOG.debug(
            "recording %s on result %s for saved query %s",
            feedback.kind.value,
            feedback.canonical_search_result_id,
            feedback.saved_query_id,
        )
        result = await result_store.get_canonical(feedback.canonical_search_result_id)
        if result is None:
            _LOG.warning(
                "feedback targets unknown result %s; aborting",
                feedback.canonical_search_result_id,
            )
            raise UnknownResultError(feedback.canonical_search_result_id)
        await feedback_store.add(feedback)
        existing = await preference_store.get(feedback.saved_query_id)
        _LOG.debug(
            "%s preference profile for saved query %s",
            "loaded" if existing is not None else "creating fresh",
            feedback.saved_query_id,
        )
        profile = existing or PreferenceProfile(saved_query_id=feedback.saved_query_id)
        vector, summary = await asyncio.gather(
            self._vector_for(result),
            self._summarize(profile.nl_summary, feedback, result),
        )
        updated = fold_feedback(profile, feedback.kind, vector, summary)
        await preference_store.upsert(updated)
        _LOG.debug("updated preference profile for saved query %s", feedback.saved_query_id)
        return updated

    async def _vector_for(self, result: CanonicalSearchResult) -> Vector:
        if result.embedding is not None:
            _LOG.debug("reusing stored embedding for result %s", result.id)
            return result.embedding
        _LOG.debug("no stored embedding for result %s; embedding on the fly", result.id)
        [vector] = await self._embedder.embed([f"{result.title}\n{result.description}".strip()])
        return vector

    async def _summarize(
        self, current_summary: str, feedback: Feedback, result: CanonicalSearchResult
    ) -> str:
        prompt = build_summary_prompt(self._system_prompt, current_summary, feedback, result)
        reply = await self._summarizer.complete(
            prompt, model=self._model, temperature=self._temperature
        )
        summary = parse_summary(reply)
        _LOG.debug("summary rewritten: %d -> %d chars", len(current_summary), len(summary))
        return summary


__all__ = ["PreferenceLearner", "ProfileUpdater", "UnknownResultError"]
