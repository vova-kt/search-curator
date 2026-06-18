"""`LLMClient` over OpenAI's Chat Completions API (extra `llm`). One
`chat.completions.create` call per `complete()`: messages in, assistant text out.
Imported only via the module door's lazy re-export, so the base `llm` import never
needs the extra — and `from events_curator.llm import OpenAIChat` raises a clear
ImportError when `llm` isn't installed."""

from __future__ import annotations

from collections.abc import Sequence
from typing import cast

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from events_curator.llm import ChatMessage, LLMClient


class OpenAIChat(LLMClient):
    def __init__(self, *, api_key: str = "", client: AsyncOpenAI | None = None) -> None:
        self._client = client or AsyncOpenAI(api_key=api_key)

    async def complete(
        self, messages: Sequence[ChatMessage], *, model: str, temperature: float = 0.0
    ) -> str:
        payload = cast(
            "list[ChatCompletionMessageParam]",
            [{"role": m.role, "content": m.content} for m in messages],
        )
        response = await self._client.chat.completions.create(
            model=model,
            messages=payload,
            temperature=temperature,
        )
        return response.choices[0].message.content or ""
