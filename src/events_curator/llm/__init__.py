"""LLM port. Used by dedup (tiebreak judge), rank (preference reranker), and
feedback (profile summarization).

`ChatMessage`, the `LLMClient` protocol, and the `UnconfiguredLLM` default are the
dependency-free core. `OpenAIChat` (the concrete adapter, extra `llm`) is
re-exported lazily, so importing this door never pulls in the optional extra.
`from events_curator.llm import OpenAIChat` loads it on demand and raises a clear
ImportError if `llm` is not installed — same pattern as `search.OpenAIWebSearch`
and `storage.SqliteStorage`.
"""

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
    ) -> str:
        """Complete a chat. `model` and `temperature` are per-call so one client can
        serve every call site, each with its own configured model/temperature."""
        ...


class UnconfiguredLLM:
    """Default placeholder. Swap in `OpenAIChat` (extra `llm`) or another adapter."""

    async def complete(
        self, messages: Sequence[ChatMessage], *, model: str, temperature: float = 0.0
    ) -> str:
        del messages, model, temperature
        raise NotImplementedError("No LLM adapter; install the `llm` extra and wire one.")


__all__ = ["ChatMessage", "LLMClient", "OpenAIChat", "UnconfiguredLLM"]


def __getattr__(name: str) -> object:
    if name == "OpenAIChat":
        from events_curator.llm.openai_chat import OpenAIChat  # noqa: PLC0415

        return OpenAIChat
    raise AttributeError(f"module {__name__!r} has no attribute {name}")
