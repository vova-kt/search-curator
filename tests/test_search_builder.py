"""The search-builder dialogue agent. The prompt/tool/parse helpers are dependency-
free (they unit-test without the network); `SearchBuilder` drives an `LLMClient`
via the submit-tool pattern. A turn yields a `SearchDraft` only when the model
marks itself ready with non-empty search text; anything malformed degrades to a
re-ask so the dialogue never wedges."""

from __future__ import annotations

import json

from events_curator.llm import ChatMessage
from events_curator.search_builder import (
    SUBMIT_TOOL_NAME,
    SearchBuilder,
    build_messages,
    parse_turn,
    submit_tool,
)


class FakeBuilderLLM:
    """Returns a preset submit-tool reply and records the tool/messages it saw."""

    def __init__(self, reply: str) -> None:
        self._reply = reply
        self.calls = 0
        self.tools: list[dict[str, object]] = []
        self.messages: list[object] = []

    async def submit(
        self, messages: object, *, tool: dict[str, object], model: str, temperature: float = 0.0
    ) -> str:
        del model, temperature
        self.calls += 1
        self.tools.append(tool)
        self.messages.append(messages)
        return self._reply

    async def complete(self, messages: object, *, model: str, temperature: float = 0.0) -> str:
        del messages, model, temperature
        raise NotImplementedError  # the builder answers via submit only


def _response(**fields: object) -> str:
    return json.dumps(fields)


# --- tool + prompt ---------------------------------------------------------


def test_submit_tool_exposes_the_builder_response_schema() -> None:
    tool = submit_tool()
    assert tool["function"]["name"] == SUBMIT_TOOL_NAME  # type: ignore[index]
    params = tool["function"]["parameters"]  # type: ignore[index]
    assert "message" in params["properties"]
    assert "ready" in params["properties"]
    assert "text" in params["properties"]


def test_build_messages_prepends_the_system_prompt() -> None:
    messages = build_messages("be a builder", [ChatMessage(role="user", content="jazz")])
    assert [m.role for m in messages] == ["system", "user"]
    assert messages[0].content == "be a builder"


# --- parse_turn ------------------------------------------------------------


def test_parse_turn_returns_a_draft_when_ready() -> None:
    turn = parse_turn(
        _response(
            message="Here's your search:",
            ready=True,
            text="jazz",
            city="Berlin",
            schedule_cron="0 9 * * 1",
            schedule_text="every Monday 09:00 UTC",
            max_results_shown=5,
        )
    )
    assert turn.draft is not None
    assert turn.draft.text == "jazz"
    assert turn.draft.city == "Berlin"
    assert turn.draft.schedule_cron == "0 9 * * 1"
    assert turn.draft.schedule_text == "every Monday 09:00 UTC"
    assert turn.draft.max_results_shown == 5
    assert turn.message == "Here's your search:"


def test_parse_turn_maps_blank_optionals_to_none() -> None:
    turn = parse_turn(
        _response(
            message="ok", ready=True, text="jazz", city="  ", schedule_cron="", schedule_text=""
        )
    )
    assert turn.draft is not None
    assert turn.draft.city is None
    assert turn.draft.schedule_cron is None
    assert turn.draft.schedule_text is None


def test_parse_turn_not_ready_yields_no_draft() -> None:
    turn = parse_turn(_response(message="Which city?", ready=False))
    assert turn.draft is None
    assert turn.message == "Which city?"


def test_parse_turn_ready_but_blank_text_re_asks() -> None:
    turn = parse_turn(_response(message="almost there", ready=True, text="   "))
    assert turn.draft is None
    assert turn.message == "almost there"


def test_parse_turn_degrades_on_malformed_payload() -> None:
    turn = parse_turn("not json at all")
    assert turn.draft is None
    assert "restate" in turn.message  # the fallback re-ask


# --- SearchBuilder ---------------------------------------------------------


async def test_advance_submits_the_tool_and_returns_the_turn() -> None:
    llm = FakeBuilderLLM(
        _response(message="Here's your search:", ready=True, text="jazz", schedule_cron="0 9 * * 1")
    )
    builder = SearchBuilder(llm, system_prompt="build", model="test-model")

    turn = await builder.advance([ChatMessage(role="user", content="jazz, weekly")])

    assert llm.calls == 1
    assert llm.tools[0] == submit_tool()
    assert turn.draft is not None
    assert turn.draft.text == "jazz"


async def test_advance_passes_a_not_ready_turn_through() -> None:
    builder = SearchBuilder(
        FakeBuilderLLM(_response(message="Which city?", ready=False)),
        system_prompt="build",
        model="m",
    )

    turn = await builder.advance([ChatMessage(role="user", content="find me jazz")])

    assert turn.draft is None
    assert turn.message == "Which city?"
