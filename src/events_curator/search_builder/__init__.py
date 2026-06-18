"""Search-builder: a small conversational agent that gathers a new saved query
from a user across several chat turns.

Unlike the pipeline stages (one input → one output), this is a *dialogue*: the
user describes what they want in free text, the agent asks for whatever is still
missing (a schedule, maybe a city), and once it has enough it presents a final
`SearchDraft` the UI turns into a `SavedQuery`. The whole exchange is one LLM
call per turn, using the same submit-tool pattern as the stages — the model
returns a typed `BuilderResponse` (its reply to the user + the fields gathered so
far + a `ready` flag) instead of free-form prose, so the UI never parses chat.

It is frontend-neutral: it speaks `ChatMessage`s, not Telegram updates, so any
chat frontend can drive it. The prompt/tool/parse helpers are dependency-free
(no LLM adapter), so they unit-test without the network; `SearchBuilder` drives
an `LLMClient`.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass

from pydantic import BaseModel, Field, ValidationError

from events_curator.llm import ChatMessage, LLMClient

_LOG = logging.getLogger("events_curator.search_builder")

SUBMIT_TOOL_NAME = "submit_draft"
_SUBMIT_TOOL_DESCRIPTION = (
    "Reply to the user and report the recurring search gathered so far. Call this "
    "on every turn: while still gathering, set ready=false and ask for what's "
    "missing in `message`; once you have the search text and a schedule, set "
    "ready=true and put a short confirmation summary in `message`."
)


class SearchDraft(BaseModel):
    """The recurring search gathered from the conversation, ready to confirm. The
    UI maps a confirmed draft onto a `SavedQuery` (same field names)."""

    text: str
    city: str | None = None
    schedule_cron: str | None = None  # 5-field UTC cron
    schedule_text: str | None = None  # human-readable echo of the schedule
    max_results_shown: int = 10


class BuilderResponse(BaseModel):
    """The model's typed turn output. `ready` gates whether the gathered fields
    form a final draft or the agent is still asking follow-ups."""

    message: str = Field(
        description="Your reply to the user this turn: a follow-up question while "
        "gathering, or a short confirmation summary once ready."
    )
    ready: bool = Field(
        default=False,
        description="True only when you have the search text AND a schedule and are "
        "presenting a final draft for confirmation.",
    )
    text: str = Field(
        default="", description="The search query in the user's own words (the topic to track)."
    )
    city: str = Field(
        default="",
        description="City/location to bias results toward; empty if none or not applicable.",
    )
    schedule_cron: str = Field(
        default="",
        description="5-field UTC cron for the recurring run (e.g. '0 9 * * 1'); empty until known.",
    )
    schedule_text: str = Field(
        default="",
        description="Plain-language echo of the schedule, e.g. 'every Monday at 09:00 UTC'.",
    )
    max_results_shown: int = Field(
        default=10, description="How many results to deliver to the user per run (1-50)."
    )


@dataclass(frozen=True)
class BuilderTurn:
    """One agent turn handed back to the UI: the `message` to show the user, and a
    `draft` when (and only when) the agent considers the search complete."""

    message: str
    draft: SearchDraft | None


_FALLBACK_MESSAGE = (
    "Sorry, I lost the thread there. Could you restate what you'd like to search for "
    "and how often I should check?"
)


def submit_tool() -> dict[str, object]:
    """The `submit_draft` function-tool spec; its parameters schema is generated from
    `BuilderResponse` so the turn shape stays single-sourced."""
    return {
        "type": "function",
        "function": {
            "name": SUBMIT_TOOL_NAME,
            "description": _SUBMIT_TOOL_DESCRIPTION,
            "parameters": BuilderResponse.model_json_schema(),
            "strict": False,
        },
    }


def build_messages(system: str, conversation: Sequence[ChatMessage]) -> list[ChatMessage]:
    """Prepend the role's system prompt to the running user/assistant conversation."""
    return [ChatMessage(role="system", content=system), *conversation]


def parse_turn(arguments: str) -> BuilderTurn:
    """Read a `submit_draft` call's arguments into a `BuilderTurn`. A draft is only
    returned when the model marked the turn ready and gave non-empty search text;
    a malformed payload degrades to a re-ask so the dialogue never wedges."""
    try:
        payload = BuilderResponse.model_validate_json(arguments)
    except ValidationError:
        _LOG.warning("search-builder turn did not validate; asking the user to restate")
        return BuilderTurn(message=_FALLBACK_MESSAGE, draft=None)
    text = payload.text.strip()
    if not (payload.ready and text):
        return BuilderTurn(message=payload.message.strip() or _FALLBACK_MESSAGE, draft=None)
    draft = SearchDraft(
        text=text,
        city=payload.city.strip() or None,
        schedule_cron=payload.schedule_cron.strip() or None,
        schedule_text=payload.schedule_text.strip() or None,
        max_results_shown=payload.max_results_shown,
    )
    return BuilderTurn(message=payload.message.strip() or "Here's your search:", draft=draft)


class SearchBuilder:
    """Drives one turn of the new-search dialogue: feed it the conversation so far,
    get back the agent's reply and (when complete) the gathered `SearchDraft`."""

    def __init__(
        self, llm: LLMClient, *, system_prompt: str, model: str, temperature: float = 0.0
    ) -> None:
        self._llm = llm
        self._system_prompt = system_prompt
        self._model = model
        self._temperature = temperature

    async def advance(self, conversation: Sequence[ChatMessage]) -> BuilderTurn:
        """Run one builder turn over the running conversation (user/assistant messages,
        oldest first; the latest user message last)."""
        messages = build_messages(self._system_prompt, conversation)
        arguments = await self._llm.submit(
            messages, tool=submit_tool(), model=self._model, temperature=self._temperature
        )
        turn = parse_turn(arguments)
        _LOG.info("search-builder turn: ready=%s", turn.draft is not None)
        return turn


__all__ = [
    "SUBMIT_TOOL_NAME",
    "BuilderResponse",
    "BuilderTurn",
    "SearchBuilder",
    "SearchDraft",
    "build_messages",
    "parse_turn",
    "submit_tool",
]
