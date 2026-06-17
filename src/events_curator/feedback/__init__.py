"""Feedback stage: record a like/dislike and fold it into the saved query's
preference profile.

Design (real impl, later): append the feedback, then update the profile's
natural-language summary (LLM) and its liked/disliked centroids (embedder).
Both signals are scoped to the saved query, so each recurrent search learns its
own taste.
"""

from __future__ import annotations

from typing import Protocol

from events_curator.models import Feedback, PreferenceProfile
from events_curator.storage import FeedbackStore, PreferenceStore


class PreferenceLearner(Protocol):
    async def record(
        self,
        feedback: Feedback,
        *,
        feedback_store: FeedbackStore,
        preference_store: PreferenceStore,
    ) -> PreferenceProfile: ...


class ProfileUpdater:
    """STUB for the NL-summary + centroid update above. Needs an Embedder and an
    LLMClient wired in; raises until then."""

    async def record(
        self,
        feedback: Feedback,
        *,
        feedback_store: FeedbackStore,
        preference_store: PreferenceStore,
    ) -> PreferenceProfile:
        del feedback, feedback_store, preference_store
        raise NotImplementedError("ProfileUpdater is a stub; wire an embedder + LLM summarizer.")


__all__ = ["PreferenceLearner", "ProfileUpdater"]
