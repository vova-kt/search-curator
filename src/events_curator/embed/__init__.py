"""Embedding port. Used by dedup (semantic similarity) and rank/feedback (taste
vectors).

`Embedder` (the protocol) and `UnconfiguredEmbedder` (the default placeholder) are
the dependency-free core. The concrete adapters are re-exported lazily so importing
this door never pulls in an optional extra: `BgeEmbedder` (a local
`SentenceTransformer`, extra `embed`, the CPU-friendly bge-small default) and
`OpenAIEmbedder` (the embeddings API, extra `llm`). Same lazy-door pattern as
`llm.OpenAIChat` / `storage.SqliteStorage` — `from events_curator.embed import
BgeEmbedder` loads it on demand and raises a clear ImportError if the extra is
missing."""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, Protocol

from events_curator.models import Vector

if TYPE_CHECKING:
    from events_curator.embed.openai_embed import OpenAIEmbedder
    from events_curator.embed.sentence_transformer import BgeEmbedder


class Embedder(Protocol):
    async def embed(self, texts: Sequence[str]) -> list[Vector]: ...


class UnconfiguredEmbedder:
    """Default placeholder. Swap in `BgeEmbedder` (extra `embed`) or `OpenAIEmbedder`
    (extra `llm`)."""

    async def embed(self, texts: Sequence[str]) -> list[Vector]:
        del texts
        raise NotImplementedError("No embedder configured; install the `embed` extra and wire one.")


__all__ = ["BgeEmbedder", "Embedder", "OpenAIEmbedder", "UnconfiguredEmbedder"]


def __getattr__(name: str) -> object:
    if name == "BgeEmbedder":
        from events_curator.embed.sentence_transformer import BgeEmbedder  # noqa: PLC0415

        return BgeEmbedder
    if name == "OpenAIEmbedder":
        from events_curator.embed.openai_embed import OpenAIEmbedder  # noqa: PLC0415

        return OpenAIEmbedder
    raise AttributeError(f"module {__name__!r} has no attribute {name}")
