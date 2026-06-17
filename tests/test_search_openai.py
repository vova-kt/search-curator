"""OpenAIWebSearch wiring (the `llm` extra): it asks the Responses API with the
native web-search tool and feeds the reply through parse_extracted. The network
call is stubbed — only the request shape and response handling are under test."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

pytest.importorskip("openai")  # the `llm` extra; skip the suite without it

from openai import AsyncOpenAI

from events_curator.search import OpenAIWebSearch


async def test_find_requests_web_search_and_parses_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_create(**kwargs: Any) -> Any:
        captured.update(kwargs)
        return SimpleNamespace(output_text='{"results": [{"url": "https://a.com", "title": "A"}]}')

    client = AsyncOpenAI(api_key="test")
    monkeypatch.setattr(client.responses, "create", fake_create)
    backend = OpenAIWebSearch(model="gpt-4o-mini", client=client)

    rows = await backend.find("jazz in berlin", max_results=3)

    assert [r.url for r in rows] == ["https://a.com"]
    assert captured["model"] == "gpt-4o-mini"
    assert captured["tools"] == [{"type": "web_search"}]
    assert "jazz in berlin" in captured["input"]
