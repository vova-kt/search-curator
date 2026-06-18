"""Prompt and parse helpers for a native web-search backend: how we ask a model
to return structured rows and how we read them back. Extraction goes through a
`submit_results` function tool whose JSON schema is derived from `ExtractedResult`,
so the backend reads typed tool arguments instead of parsing free-form prose. Kept
dependency-free and apart from the OpenAI adapter so the contract is unit-testable
without the network (or the `llm` extra)."""

from __future__ import annotations

import json
import logging
from typing import cast

from pydantic import ValidationError

from events_curator.enums import Stage
from events_curator.search.frontier import ExtractedResult, ExtractedResults

# Helper of the search stage, so its parse trace groups under the search stage
# logger (`events_curator.stage.search`) for per-stage tuning.
_LOG = logging.getLogger(f"events_curator.stage.{Stage.SEARCH.value}")

SUBMIT_TOOL_NAME = "submit_search_results"
_SUBMIT_TOOL_DESCRIPTION = (
    "Submit every structured result you found for the request. Call this once, "
    "when your research is complete."
)


def build_search_prompt(template: str, query: str, *, max_results: int) -> str:
    """Fill the configured input-prompt template (`[search].prompt`) with this query
    and result budget. The template carries `{query}` and `{max_results}` fields."""
    return template.format(query=query, max_results=max_results)


def submit_tool() -> dict[str, object]:
    """The `submit_results` function-tool spec for the Responses API. Its parameters
    schema is generated from `ExtractedResults`, so the model returns the batch as
    typed tool arguments and the row shape stays single-sourced in the model."""
    return {
        "type": "function",
        "name": SUBMIT_TOOL_NAME,
        "description": _SUBMIT_TOOL_DESCRIPTION,
        "parameters": ExtractedResults.model_json_schema(),
        "strict": False,
    }


def parse_submission(arguments: str, *, max_results: int) -> list[ExtractedResult]:
    """Read the `submit_results` call's JSON arguments into validated rows. The
    arguments must parse (malformed tool output is a real failure, not silently
    dropped); individual rows that fail validation are skipped as model noise."""
    payload: object = json.loads(arguments)
    raw = cast("dict[str, object]", payload).get("results") if isinstance(payload, dict) else None
    if not isinstance(raw, list):
        _LOG.warning("submit call carried no results array; treating as zero rows")
        return []
    rows = cast("list[object]", raw)
    _LOG.debug(f"parsing {len(rows)} submitted row(s) (max_results={max_results})")
    results: list[ExtractedResult] = []
    skipped = 0
    for row in rows:
        if len(results) >= max_results:
            _LOG.debug(f"skipping remaining rows due to {max_results} limit")
            break
        if isinstance(row, dict):
            try:
                results.append(ExtractedResult.model_validate(row))
            except ValidationError:
                _LOG.warning(f"skipping invalid row: {row}")
                skipped += 1
        else:
            skipped += 1
    _LOG.debug(f"extracted {len(results)} result(s), skipped {skipped} invalid row(s)")
    return results
