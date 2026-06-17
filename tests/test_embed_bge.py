"""BgeEmbedder wiring (the `embed` extra): the model loads lazily so empty input
short-circuits without loading it, and `_encode` asks for normalized embeddings and
returns plain float vectors. The SentenceTransformer is faked — only the adapter's
contract is under test, not the model."""

from __future__ import annotations

from typing import Any

import pytest

from events_curator.embed import BgeEmbedder


async def test_embed_empty_does_not_load_model(monkeypatch: pytest.MonkeyPatch) -> None:
    embedder = BgeEmbedder(model="BAAI/bge-small-en-v1.5")

    def boom() -> Any:
        raise AssertionError("model must not load for empty input")

    monkeypatch.setattr(embedder, "_load", boom)
    assert await embedder.embed([]) == []


async def test_encode_normalizes_and_returns_floats(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    class FakeModel:
        def encode(self, texts: list[str], **kwargs: Any) -> Any:
            captured["texts"] = texts
            captured["kwargs"] = kwargs
            return [[1, 0], [0, 1]]  # ints -> the adapter must coerce to float

    embedder = BgeEmbedder(model="BAAI/bge-small-en-v1.5")
    monkeypatch.setattr(embedder, "_load", FakeModel)

    vectors = await embedder.embed(["a", "b"])

    assert vectors == [[1.0, 0.0], [0.0, 1.0]]
    assert all(isinstance(value, float) for row in vectors for value in row)
    assert captured["texts"] == ["a", "b"]
    assert captured["kwargs"]["normalize_embeddings"] is True
