"""OpenAIWebSearch wiring (the `llm` extra): it asks the Responses API with the
native web-search tool plus a `submit_results` function tool, then reads that
tool call's typed arguments through parse_submission. The web_search tool and
reasoning effort are tuned from config. The network call is stubbed — only the
request shape and response handling are under test."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

pytest.importorskip("openai")  # the `llm` extra; skip the suite without it

from openai import AsyncOpenAI
from openai.types.responses import ResponseFunctionToolCall

from events_curator.enums import ReasoningEffort, SearchContextSize
from events_curator.search import GeoBias, OpenAIWebSearch, WebSearchTuning
from events_curator.search._extract import SUBMIT_TOOL_NAME


def _tuning(**overrides: Any) -> WebSearchTuning:
    base: dict[str, Any] = {
        "search_context_size": SearchContextSize.HIGH,
        "reasoning_effort": ReasoningEffort.LOW,
    }
    base.update(overrides)
    return WebSearchTuning(**base)


def _backend(client: AsyncOpenAI, tuning: WebSearchTuning | None = None) -> OpenAIWebSearch:
    return OpenAIWebSearch(
        model="gpt-4o-mini", instructions="find stuff", tuning=tuning or _tuning(), client=client
    )


def _web_search(tools: list[dict[str, Any]]) -> dict[str, Any]:
    return next(t for t in tools if t.get("type") == "web_search")


async def test_find_offers_both_tools_and_parses_submit_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def fake_create(**kwargs: Any) -> Any:
        captured.update(kwargs)
        return SimpleNamespace(
            output=[
                ResponseFunctionToolCall(
                    type="function_call",
                    call_id="call_1",
                    name=SUBMIT_TOOL_NAME,
                    arguments='{"results": [{"url": "https://a.com", "title": "A"}]}',
                )
            ]
        )

    client = AsyncOpenAI(api_key="test")
    monkeypatch.setattr(client.responses, "create", fake_create)

    rows = await _backend(client).find("jazz in berlin", max_results=3)

    assert [r.url for r in rows] == ["https://a.com"]
    assert captured["model"] == "gpt-4o-mini"
    assert captured["instructions"] == "find stuff"
    assert "jazz in berlin" in captured["input"]
    assert captured["reasoning"]["effort"] == "low"
    web_search = _web_search(captured["tools"])
    assert web_search["search_context_size"] == "high"
    assert any(t.get("name") == SUBMIT_TOOL_NAME for t in captured["tools"])


async def test_find_includes_location_and_domain_filters(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_create(**kwargs: Any) -> Any:
        captured.update(kwargs)
        return SimpleNamespace(output=[])

    client = AsyncOpenAI(api_key="test")
    monkeypatch.setattr(client.responses, "create", fake_create)
    tuning = _tuning(
        allowed_domains=["arxiv.org"],
        location=GeoBias(city="Berlin", country="DE"),
    )

    await _backend(client, tuning).find("jazz", max_results=3)

    web_search = _web_search(captured["tools"])
    assert web_search["filters"]["allowed_domains"] == ["arxiv.org"]
    assert web_search["user_location"] == {
        "type": "approximate",
        "city": "Berlin",
        "country": "DE",
    }


async def test_find_omits_location_and_filters_when_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def fake_create(**kwargs: Any) -> Any:
        captured.update(kwargs)
        return SimpleNamespace(output=[])

    client = AsyncOpenAI(api_key="test")
    monkeypatch.setattr(client.responses, "create", fake_create)

    await _backend(client).find("jazz", max_results=3)

    web_search = _web_search(captured["tools"])
    assert "filters" not in web_search
    assert "user_location" not in web_search


async def test_find_returns_empty_without_submit_call(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_create(**kwargs: Any) -> Any:
        del kwargs
        return SimpleNamespace(output=[])

    client = AsyncOpenAI(api_key="test")
    monkeypatch.setattr(client.responses, "create", fake_create)

    assert await _backend(client).find("jazz in berlin", max_results=3) == []
