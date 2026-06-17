"""`Embedder` over OpenAI's embeddings API (extra `llm`), e.g.
`text-embedding-3-small`. One `embeddings.create` call per `embed()`: all texts
batched in, vectors out in input order. Imported only via the module door's lazy
re-export — same pattern as `llm.OpenAIChat` — so the base `embed` import never
needs the extra."""

from __future__ import annotations

from collections.abc import Sequence

from openai import AsyncOpenAI

from events_curator.models import Vector


class OpenAIEmbedder:
    def __init__(self, *, model: str, api_key: str = "", client: AsyncOpenAI | None = None) -> None:
        self._model = model
        self._client = client or AsyncOpenAI(api_key=api_key)

    async def embed(self, texts: Sequence[str]) -> list[Vector]:
        if not texts:
            return []
        response = await self._client.embeddings.create(model=self._model, input=list(texts))
        return [list(item.embedding) for item in response.data]
