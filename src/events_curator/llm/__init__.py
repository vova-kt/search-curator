from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, Protocol

from pydantic import BaseModel

if TYPE_CHECKING:
    from events_curator.llm.openai_chat import OpenAIChat


class ChatMessage(BaseModel):
    role: str  # "system" | "user" | "assistant"
    content: str


class LLMClient(Protocol):
    async def complete(
        self, messages: Sequence[ChatMessage], *, model: str, temperature: float = 0.0
    ) -> str: ...

    async def submit(
        self,
        messages: Sequence[ChatMessage],
        *,
        tool: dict[str, object],
        model: str,
        temperature: float = 0.0,
    ) -> str:
        """The submit-tool pattern: the caller derives `tool` from a Pydantic schema,
        so the model returns typed arguments instead of free-form prose"""
        ...


__all__ = ["ChatMessage", "LLMClient", "OpenAIChat"]


def __getattr__(name: str) -> object:
    if name == "OpenAIChat":
        from events_curator.llm.openai_chat import OpenAIChat  # noqa: PLC0415

        return OpenAIChat
    raise AttributeError(f"module {__name__!r} has no attribute {name}")
