"""`WebSearchBackend` over OpenAI's Responses API native web-search tool (extra
`llm`). One `responses.create` call per query: the model searches the web, reads
pages, and returns the structured rows `parse_extracted` validates. Imported only
via the module door's lazy re-export, so the base `search` import never needs the
extra — and `from events_curator.search import OpenAIWebSearch` raises a clear
ImportError when `llm` isn't installed."""

from __future__ import annotations

from openai import AsyncOpenAI
from openai.types.responses import WebSearchToolParam

from events_curator.search._extract import (
    SEARCH_INSTRUCTIONS,
    build_search_prompt,
    parse_extracted,
)
from events_curator.search.frontier import ExtractedResult


class OpenAIWebSearch:
    def __init__(self, *, model: str, api_key: str = "", client: AsyncOpenAI | None = None) -> None:
        self._model = model
        self._client = client or AsyncOpenAI(api_key=api_key)

    async def find(self, query: str, *, max_results: int) -> list[ExtractedResult]:
        response = await self._client.responses.create(
            model=self._model,
            instructions=SEARCH_INSTRUCTIONS,
            input=build_search_prompt(query, max_results=max_results),
            tools=[WebSearchToolParam(type="web_search")],
        )
        return parse_extracted(response.output_text, max_results=max_results)
