"""Prompt and parse helpers for a native web-search backend: how we ask a model
to return structured rows and how we read them back. Kept dependency-free and
apart from the OpenAI adapter so the contract is unit-testable without the
network (or the `llm` extra)."""

from __future__ import annotations

import json
import re
from typing import cast

from pydantic import ValidationError

from events_curator.search.frontier import ExtractedResult

SEARCH_INSTRUCTIONS = (
    "You are a web research assistant. Use web search to find current, real "
    "results that satisfy the user's request, read the pages you find, and "
    "extract structured data. Reply with ONLY a JSON object of the form "
    '{"results": [...]} — no prose, no code fences. Each element has keys: url '
    "(an absolute http(s) URL), title, description, starts_at and ends_at (ISO "
    "8601 or null), city, country, venue, tags (array of strings), price (string "
    "or null). Omit any result you cannot tie to a real URL."
)

_FENCE = re.compile(r"\A```[a-zA-Z0-9]*\n(.*)\n```\Z", re.DOTALL)


def build_search_prompt(query: str, *, max_results: int) -> str:
    return f"Find up to {max_results} results for: {query}"


def parse_extracted(text: str, *, max_results: int) -> list[ExtractedResult]:
    """Read a model's JSON reply into validated rows. The top-level payload must
    parse (a malformed reply is a real failure, not silently dropped); individual
    rows that fail validation are skipped as expected model noise."""
    results: list[ExtractedResult] = []
    for row in _rows(text):
        if len(results) >= max_results:
            break
        if isinstance(row, dict):
            try:
                results.append(ExtractedResult.model_validate(row))
            except ValidationError:
                continue
    return results


def _rows(text: str) -> list[object]:
    payload: object = json.loads(_strip_fence(text))
    if isinstance(payload, dict):
        payload = cast("dict[str, object]", payload).get("results")
    return cast("list[object]", payload) if isinstance(payload, list) else []


def _strip_fence(text: str) -> str:
    stripped = text.strip()
    match = _FENCE.match(stripped)
    return match.group(1) if match else stripped
