"""The taste-vector signal, kept dependency-free (no embedder/LLM adapter) so the
scoring contract is unit-testable without the network — mirrors ``dedup/_match.py``.

A result's taste score is its position on the profile's preference axis: cosine to
the liked centroid minus cosine to the disliked centroid (concept:
``docs/concepts/taste-vectors.md``). A missing centroid contributes 0, so the score
is well-defined from the very first label and at cold start (no centroids -> 0 for
every result, leaving input order untouched for the LLM reranker to resolve)."""

from __future__ import annotations

import math

from events_curator.models import CanonicalSearchResult, PreferenceProfile, Vector


def cosine(a: Vector, b: Vector) -> float:
    if not a or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return 0.0 if na == 0.0 or nb == 0.0 else dot / (na * nb)


def taste_score(embedding: Vector, profile: PreferenceProfile) -> float:
    """Project a result's embedding onto the profile's liked-minus-disliked axis.
    Closer to the liked centroid and farther from the disliked one scores higher."""
    liked = cosine(embedding, profile.liked_centroid) if profile.liked_centroid else 0.0
    disliked = cosine(embedding, profile.disliked_centroid) if profile.disliked_centroid else 0.0
    return liked - disliked


def doc_text(result: CanonicalSearchResult) -> str:
    """Text used to embed a result that has no stored embedding: title + description."""
    return f"{result.title}\n{result.description}".strip()
