"""LLM port. Used by dedup (tiebreak judge), rank (preference reranker), and
feedback (profile summarization). Concrete adapters live behind this door."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: str  # "system" | "user" | "assistant"
    content: str


class LLMClient(Protocol):
    async def complete(
        self,
        messages: Sequence[ChatMessage],
        *,
        temperature: float = 0.0,
    ) -> str: ...


class UnconfiguredLLM:
    """Default placeholder. Swap in an OpenAI/Anthropic adapter (extra `llm`)."""

    async def complete(
        self,
        messages: Sequence[ChatMessage],
        *,
        temperature: float = 0.0,
    ) -> str:
        del messages, temperature
        raise NotImplementedError("No LLM adapter; install the `llm` extra and wire one.")


__all__ = ["ChatMessage", "LLMClient", "UnconfiguredLLM"]
