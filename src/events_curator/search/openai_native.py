"""`WebSearchBackend` over OpenAI's Responses API native web-search tool (extra
`llm`). One `responses.create` call per query: the model searches the web, reads
pages, and reports its findings by calling the `submit_results` function tool,
whose typed arguments `parse_submission` validates. The `WebSearchTuning` resolved
from config maps onto the Responses `web_search` tool (context size, domain
allow-list) and `reasoning.effort`; the per-user `GeoBias` passed to `find` adds
the tool's approximate `user_location`. Imported only via the module
door's lazy re-export, so the base `search` import never needs the extra — and
`from events_curator.search import OpenAIWebSearch` raises a clear ImportError when
`llm` isn't installed."""

from __future__ import annotations

from typing import cast

from openai import AsyncOpenAI
from openai.types.responses import (
    FunctionToolParam,
    ResponseFunctionToolCall,
    WebSearchToolParam,
)
from openai.types.responses.web_search_tool_param import Filters, UserLocation
from openai.types.shared_params import Reasoning

from events_curator.search._extract import (
    SUBMIT_TOOL_NAME,
    build_search_prompt,
    parse_submission,
    submit_tool,
)
from events_curator.search.frontier import (
    ExtractedResult,
    GeoBias,
    WebSearchBackend,
    WebSearchTuning,
)


class OpenAIWebSearch(WebSearchBackend):
    def __init__(
        self,
        *,
        model: str,
        instructions: str,
        prompt: str,
        tuning: WebSearchTuning,
        api_key: str = "",
        client: AsyncOpenAI | None = None,
    ) -> None:
        self._model = model
        self._instructions = instructions
        self._prompt = prompt
        self._tuning = tuning
        self._client = client or AsyncOpenAI(api_key=api_key)

    async def find(
        self, query: str, *, max_results: int, location: GeoBias
    ) -> list[ExtractedResult]:
        response = await self._client.responses.create(
            model=self._model,
            instructions=self._instructions,
            input=build_search_prompt(self._prompt, query, max_results=max_results),
            tools=[self._web_search_tool(location), cast("FunctionToolParam", submit_tool())],
            reasoning=Reasoning(effort=self._tuning.reasoning_effort.value),
        )
        for item in response.output:
            if isinstance(item, ResponseFunctionToolCall) and item.name == SUBMIT_TOOL_NAME:
                return parse_submission(item.arguments, max_results=max_results)
        return []

    def _web_search_tool(self, location: GeoBias) -> WebSearchToolParam:
        tool = WebSearchToolParam(
            type="web_search",
            search_context_size=self._tuning.search_context_size.value,
        )
        if self._tuning.allowed_domains:
            tool["filters"] = Filters(allowed_domains=list(self._tuning.allowed_domains))
        user_location = self._user_location(location)
        if user_location is not None:
            tool["user_location"] = user_location
        return tool

    @staticmethod
    def _user_location(loc: GeoBias) -> UserLocation | None:
        if not any((loc.city, loc.country, loc.region, loc.timezone)):
            return None
        location = UserLocation(type="approximate")
        if loc.city:
            location["city"] = loc.city
        if loc.country:
            location["country"] = loc.country
        if loc.region:
            location["region"] = loc.region
        if loc.timezone:
            location["timezone"] = loc.timezone
        return location
