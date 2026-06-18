"""`LLMClient` over OpenAI's Chat Completions API.
`complete()` returns assistant text;
`submit()` forces the supplied function tool and returns its raw JSON arguments
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import cast

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam, ChatCompletionToolParam

from events_curator.llm import ChatMessage, LLMClient


class OpenAIChat(LLMClient):
    def __init__(self, *, api_key: str = "", client: AsyncOpenAI | None = None) -> None:
        self._client = client or AsyncOpenAI(api_key=api_key)

    async def complete(
        self, messages: Sequence[ChatMessage], *, model: str, temperature: float = 0.0
    ) -> str:
        response = await self._client.chat.completions.create(
            model=model,
            messages=self._payload(messages),
            temperature=temperature,
        )
        return response.choices[0].message.content or ""

    async def submit(
        self,
        messages: Sequence[ChatMessage],
        *,
        tool: dict[str, object],
        model: str,
        temperature: float = 0.0,
    ) -> str:
        # `tool_choice="required"` makes the model answer through the one supplied tool
        response = await self._client.chat.completions.create(
            model=model,
            messages=self._payload(messages),
            temperature=temperature,
            tools=[cast("ChatCompletionToolParam", tool)],
            tool_choice="required",
        )
        for call in response.choices[0].message.tool_calls or []:
            if call.type == "function":
                return call.function.arguments
        return ""

    @staticmethod
    def _payload(messages: Sequence[ChatMessage]) -> list[ChatCompletionMessageParam]:
        return cast(
            "list[ChatCompletionMessageParam]",
            [{"role": m.role, "content": m.content} for m in messages],
        )
