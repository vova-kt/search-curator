"""Embedding port. Used by dedup (semantic similarity) and rank/feedback (taste
vectors).

`Embedder` (the protocol) is the dependency-free core."""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, Protocol

from events_curator.models import Vector

if TYPE_CHECKING:
    from events_curator.embed.openai_embed import OpenAIEmbedder
    from events_curator.embed.sentence_transformer import BgeEmbedder


class Embedder(Protocol):
    async def embed(self, texts: Sequence[str]) -> list[Vector]: ...


__all__ = ["BgeEmbedder", "Embedder", "OpenAIEmbedder"]


def __getattr__(name: str) -> object:
    if name == "BgeEmbedder":
        from events_curator.embed.sentence_transformer import BgeEmbedder  # noqa: PLC0415

        return BgeEmbedder
    if name == "OpenAIEmbedder":
        from events_curator.embed.openai_embed import OpenAIEmbedder  # noqa: PLC0415

        return OpenAIEmbedder
    raise AttributeError(f"module {__name__!r} has no attribute {name}")
