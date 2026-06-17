"""Centroid survivorship for feedback, kept dependency-free (no embedder/LLM
adapter) so the update math is unit-testable without the network — mirrors
``dedup/_golden.py``.

A taste centroid is the running mean of the liked (or disliked) items' embeddings
(concept: ``docs/concepts/taste-vectors.md``). Folding in one new label is an exact
incremental mean — ``(centroid * n + vector) / (n + 1)`` — so we never refetch the
whole feedback history. The matching count advances with it, and the LLM-written
summary is replaced wholesale (the summarizer regenerates it from the prior summary
plus the new label)."""

from __future__ import annotations

from datetime import UTC, datetime

from events_curator.enums import FeedbackKind
from events_curator.models import PreferenceProfile, Vector


def _running_mean(centroid: Vector | None, count: int, vector: Vector) -> Vector:
    if not centroid or count == 0:
        return list(vector)
    return [(c * count + v) / (count + 1) for c, v in zip(centroid, vector, strict=True)]


def fold_feedback(
    profile: PreferenceProfile, kind: FeedbackKind, vector: Vector, summary: str
) -> PreferenceProfile:
    """Fold one like/dislike into the profile: advance the matching centroid and
    count by the incremental mean and replace the natural-language summary. Returns
    the updated profile (the input is left untouched)."""
    updates: dict[str, object] = {"nl_summary": summary, "updated_at": datetime.now(tz=UTC)}
    if kind is FeedbackKind.LIKE:
        updates["liked_centroid"] = _running_mean(
            profile.liked_centroid, profile.like_count, vector
        )
        updates["like_count"] = profile.like_count + 1
    else:
        updates["disliked_centroid"] = _running_mean(
            profile.disliked_centroid, profile.dislike_count, vector
        )
        updates["dislike_count"] = profile.dislike_count + 1
    return profile.model_copy(update=updates)


__all__ = ["fold_feedback"]
