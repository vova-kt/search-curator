"""OpenAIChat wiring (the `llm` extra): `complete` asks the Chat Completions API
and returns the assistant text; `submit` forces the supplied function tool and
returns its raw arguments. The network call is stubbed — only the request shape and
response handling are under test."""

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
    llm = OpenAIChat(client=client)

    reply = await llm.complete(
        [ChatMessage(role="system", content="be terse"), ChatMessage(role="user", content="hi")],
        model="gpt-4o-mini",
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
    llm = OpenAIChat(client=client)

    assert await llm.complete([ChatMessage(role="user", content="hi")], model="gpt-4o-mini") == ""


async def test_submit_forces_tool_and_returns_arguments(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_create(**kwargs: Any) -> Any:
        captured.update(kwargs)
        function = SimpleNamespace(name="submit_ranking", arguments='{"ranking": []}')
        call = SimpleNamespace(type="function", function=function)
        message = SimpleNamespace(tool_calls=[call])
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    client = AsyncOpenAI(api_key="test")
    monkeypatch.setattr(client.chat.completions, "create", fake_create)
    llm = OpenAIChat(client=client)
    tool: dict[str, object] = {
        "type": "function",
        "function": {"name": "submit_ranking", "parameters": {}},
    }

    arguments = await llm.submit(
        [ChatMessage(role="user", content="rank these")], tool=tool, model="gpt-4o-mini"
    )

    assert arguments == '{"ranking": []}'
    assert captured["tools"] == [tool]
    assert captured["tool_choice"] == "required"


async def test_submit_returns_empty_without_a_tool_call(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_create(**kwargs: Any) -> Any:
        del kwargs
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(tool_calls=None))])

    client = AsyncOpenAI(api_key="test")
    monkeypatch.setattr(client.chat.completions, "create", fake_create)
    llm = OpenAIChat(client=client)
    tool: dict[str, object] = {
        "type": "function",
        "function": {"name": "submit_ranking", "parameters": {}},
    }

    assert await llm.submit([ChatMessage(role="user", content="hi")], tool=tool, model="m") == ""
