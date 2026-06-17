"""`Embedder` over a local `SentenceTransformer` (extra `embed`) — the bge-small
default. The model is loaded lazily on first `embed()`, so building the embedder is
free and a pipeline that never embeds (tests, eval, a run that stops at an earlier
stage) pays nothing. `encode` is synchronous and CPU-bound, so it runs in a worker
thread to keep `embed` non-blocking. Embeddings are L2-normalized so the cosine
scan in dedup/rank/storage reduces to a dot product."""

from __future__ import annotations

import asyncio
from collections.abc import Sequence
from typing import TYPE_CHECKING, Any, cast

from events_curator.models import Vector

if TYPE_CHECKING:
    from sentence_transformers import SentenceTransformer


class BgeEmbedder:
    def __init__(self, *, model: str) -> None:
        self._model_name = model
        self._model: SentenceTransformer | None = None

    def _load(self) -> SentenceTransformer:
        if self._model is None:
            from sentence_transformers import SentenceTransformer  # noqa: PLC0415

            self._model = SentenceTransformer(self._model_name)
        return self._model

    async def embed(self, texts: Sequence[str]) -> list[Vector]:
        if not texts:
            return []
        return await asyncio.to_thread(self._encode, list(texts))

    def _encode(self, texts: list[str]) -> list[Vector]:
        model = cast("Any", self._load())
        matrix = model.encode(texts, normalize_embeddings=True)
        return [[float(value) for value in row] for row in matrix]
