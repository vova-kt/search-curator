"""OpenAIEmbedder wiring (the `llm` extra): it batches all texts into one
`embeddings.create` call and returns the vectors in input order. The network call is
stubbed — only the request shape and response handling are under test."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

pytest.importorskip("openai")  # the `llm` extra; skip the suite without it

from openai import AsyncOpenAI

from events_curator.embed import OpenAIEmbedder


async def test_embed_batches_and_preserves_order(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_create(**kwargs: Any) -> Any:
        captured.update(kwargs)
        return SimpleNamespace(
            data=[
                SimpleNamespace(embedding=[1.0, 0.0]),
                SimpleNamespace(embedding=[0.0, 1.0]),
            ]
        )

    client = AsyncOpenAI(api_key="test")
    monkeypatch.setattr(client.embeddings, "create", fake_create)
    embedder = OpenAIEmbedder(model="text-embedding-3-small", client=client)

    vectors = await embedder.embed(["a", "b"])

    assert vectors == [[1.0, 0.0], [0.0, 1.0]]
    assert captured["model"] == "text-embedding-3-small"
    assert captured["input"] == ["a", "b"]


async def test_embed_empty_skips_request(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_create(**kwargs: Any) -> Any:
        del kwargs
        raise AssertionError("should not call the API for empty input")

    client = AsyncOpenAI(api_key="test")
    monkeypatch.setattr(client.embeddings, "create", fake_create)
    embedder = OpenAIEmbedder(model="text-embedding-3-small", client=client)

    assert await embedder.embed([]) == []
