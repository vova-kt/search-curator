"""OpenAIChat wiring (the `llm` extra): it asks the Chat Completions API with the
given messages and returns the assistant text. The network call is stubbed — only
the request shape and response handling are under test."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

pytest.importorskip("openai")  # the `llm` extra; skip the suite without it

from openai import AsyncOpenAI

from events_curator.llm import ChatMessage, OpenAIChat


async def test_complete_sends_messages_and_returns_content(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_create(**kwargs: Any) -> Any:
        captured.update(kwargs)
        message = SimpleNamespace(content="hello back")
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    client = AsyncOpenAI(api_key="test")
    monkeypatch.setattr(client.chat.completions, "create", fake_create)
    llm = OpenAIChat(model="gpt-4o-mini", client=client)

    reply = await llm.complete(
        [ChatMessage(role="system", content="be terse"), ChatMessage(role="user", content="hi")],
        temperature=0.2,
    )

    assert reply == "hello back"
    assert captured["model"] == "gpt-4o-mini"
    assert captured["temperature"] == 0.2
    assert captured["messages"] == [
        {"role": "system", "content": "be terse"},
        {"role": "user", "content": "hi"},
    ]


async def test_complete_handles_empty_content(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_create(**kwargs: Any) -> Any:
        del kwargs
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=None))])

    client = AsyncOpenAI(api_key="test")
    monkeypatch.setattr(client.chat.completions, "create", fake_create)
    llm = OpenAIChat(model="gpt-4o-mini", client=client)

    assert await llm.complete([ChatMessage(role="user", content="hi")]) == ""
