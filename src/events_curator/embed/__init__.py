"""Embedding port. Used by dedup (semantic similarity) and rank (taste vector).
Default is a local CPU-friendly model (bge-small); an API adapter is optional."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from events_curator.models import Vector


class Embedder(Protocol):
    async def embed(self, texts: Sequence[str]) -> list[Vector]: ...


class UnconfiguredEmbedder:
    """Default placeholder. Swap in a bge-small (extra `embed`) or API adapter."""

    async def embed(self, texts: Sequence[str]) -> list[Vector]:
        del texts
        raise NotImplementedError("No embedder configured; install the `embed` extra and wire one.")


__all__ = ["Embedder", "UnconfiguredEmbedder"]
