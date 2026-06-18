"""The expand stage turns a SavedQuery into the concrete web queries to run.

`IdentityExpander` returns the user's text unchanged. `LLMQueryExpander` fans out
by translation via the submit-tool pattern: the model calls `submit_queries` with
one entry per language. The prompt/tool/parse helpers are dependency-free; the
expander falls back to the original text when the model returns nothing usable.
"""

from __future__ import annotations

import json

from events_curator.expand import (
    SUBMIT_TOOL_NAME,
    IdentityExpander,
    LLMQueryExpander,
    build_expand_prompt,
    parse_queries,
    submit_tool,
)
from events_curator.models import SavedQuery, UserId


class FakeExpanderLLM:
    """Returns a preset submit-tool reply and records the prompts it saw."""

    def __init__(self, reply: str) -> None:
        self._reply = reply
        self.calls = 0
        self.tools: list[dict[str, object]] = []

    async def submit(
        self, messages: object, *, tool: dict[str, object], model: str, temperature: float = 0.0
    ) -> str:
        del messages, model, temperature
        self.calls += 1
        self.tools.append(tool)
        return self._reply

    async def complete(self, messages: object, *, model: str, temperature: float = 0.0) -> str:
        del messages, model, temperature
        raise NotImplementedError  # the expander answers via submit only


def _reply(*pairs: tuple[str, str]) -> str:
    return json.dumps({"queries": [{"language": lang, "query": q} for lang, q in pairs]})


# --- IdentityExpander ------------------------------------------------------


async def test_identity_expander_returns_singleton() -> None:
    query = SavedQuery(user_id=UserId("u1"), text="indie film amsterdam")
    expanded = await IdentityExpander().expand(query)

    assert expanded.saved_query_id == query.id
    assert [q.text for q in expanded.queries] == ["indie film amsterdam"]
    assert expanded.queries[0].saved_query_id == query.id


# --- tool + prompt ---------------------------------------------------------


def test_submit_tool_exposes_a_per_language_query_list() -> None:
    tool = submit_tool()
    assert tool["function"]["name"] == SUBMIT_TOOL_NAME  # type: ignore[index]
    params = tool["function"]["parameters"]  # type: ignore[index]
    assert "queries" in params["properties"]


def test_build_expand_prompt_carries_query_and_location() -> None:
    messages = build_expand_prompt(
        "be an expander", "русский стендап", city="Paris", country="France"
    )
    assert [m.role for m in messages] == ["system", "user"]
    assert messages[0].content == "be an expander"
    assert "русский стендап" in messages[1].content
    assert "Paris, France" in messages[1].content


def test_build_expand_prompt_marks_unknown_location() -> None:
    messages = build_expand_prompt("sys", "jazz", city=None, country=None)
    assert "unspecified" in messages[1].content


# --- parse_queries ---------------------------------------------------------


def test_parse_queries_returns_language_query_pairs() -> None:
    pairs = parse_queries(_reply(("English", "russian stand-up in paris"), ("French", "humour")))
    assert pairs == [("English", "russian stand-up in paris"), ("French", "humour")]


def test_parse_queries_dedupes_by_text_case_insensitively() -> None:
    pairs = parse_queries(_reply(("English", "jazz"), ("British English", "Jazz")))
    assert pairs == [("English", "jazz")]


def test_parse_queries_drops_blanks_and_falls_back_to_empty() -> None:
    assert parse_queries(_reply(("English", "   "))) == []
    assert parse_queries("not json") == []


# --- LLMQueryExpander ------------------------------------------------------


async def test_expander_fans_out_into_one_query_per_language() -> None:
    llm = FakeExpanderLLM(
        _reply(
            ("Russian", "русский стендап в париже"),
            ("French", "stand-up russe à paris"),
            ("English", "russian stand-up in paris"),
        )
    )
    expander = LLMQueryExpander(llm, system_prompt="expand", model="test-model")
    query = SavedQuery(user_id=UserId("u1"), text="русский стендап в париже", city="Paris")

    expanded = await expander.expand(query)

    assert llm.calls == 1
    assert llm.tools[0] == submit_tool()
    assert [q.text for q in expanded.queries] == [
        "русский стендап в париже",
        "stand-up russe à paris",
        "russian stand-up in paris",
    ]
    assert all(q.saved_query_id == query.id for q in expanded.queries)


async def test_expander_falls_back_to_original_text_when_model_returns_nothing() -> None:
    expander = LLMQueryExpander(FakeExpanderLLM("not json"), system_prompt="expand", model="m")
    query = SavedQuery(user_id=UserId("u1"), text="jazz in berlin")

    expanded = await expander.expand(query)

    assert [q.text for q in expanded.queries] == ["jazz in berlin"]
