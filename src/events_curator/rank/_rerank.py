"""The preference reranker's prompt/submit contract, kept dependency-free (no LLM
adapter).

Ordering comes back as typed tool arguments (a ``Ranking``). Candidates are addressed by
small integer index rather than their uuid id."""

from __future__ import annotations

import logging

from pydantic import BaseModel, Field, ValidationError

from events_curator.enums import Stage
from events_curator.llm import ChatMessage
from events_curator.models import CanonicalSearchResult, SavedQuery

_LOG = logging.getLogger(f"events_curator.stage.{Stage.RANK.value}")

SUBMIT_TOOL_NAME = "submit_ranking"
_SUBMIT_TOOL_DESCRIPTION = (
    "Submit the final ranking of the candidates, best fit first. Call this once, "
    "listing every candidate number exactly once."
)


class RankedCandidate(BaseModel):
    id: int = Field(description="1-based number of a candidate from the list.")
    why: str | None = Field(
        default=None, description="One short clause on why it ranks here, if any."
    )


class Ranking(BaseModel):
    ranking: list[RankedCandidate] = Field(
        default_factory=list[RankedCandidate],
        description="Every candidate, ordered best-first, each listed exactly once.",
    )


def submit_tool() -> dict[str, object]:
    return {
        "type": "function",
        "function": {
            "name": SUBMIT_TOOL_NAME,
            "description": _SUBMIT_TOOL_DESCRIPTION,
            "parameters": Ranking.model_json_schema(),
            "strict": False,
        },
    }


def _render(index: int, result: CanonicalSearchResult) -> str:
    when = result.starts_at.date().isoformat() if result.starts_at else "unknown"
    attrs = (
        ", ".join(f"{k}={v}" for k, v in result.attributes.items()) if result.attributes else "none"
    )
    return (
        f"{index}. {result.title}\n"
        f"   description: {result.description or 'none'}\n"
        f"   date: {when}; city: {result.geo.city or 'unknown'}; attributes: {attrs}"
    )


def build_rerank_prompt(
    system: str, results: list[CanonicalSearchResult], *, summary: str, query: SavedQuery
) -> list[ChatMessage]:
    catalog = "\n".join(_render(i + 1, r) for i, r in enumerate(results))
    taste = summary.strip() or "(no learned taste yet — fall back to relevance to the query)"
    body = (
        f"Query: {query.text}\n\n"
        f"Learned taste:\n{taste}\n\n"
        f"Candidates:\n{catalog}\n\n"
        f"Call {SUBMIT_TOOL_NAME} with every candidate ordered best-first."
    )
    return [
        ChatMessage(role="system", content=system),
        ChatMessage(role="user", content=body),
    ]


def parse_submission(arguments: str, *, count: int) -> list[tuple[int, str | None]]:
    """Parse conservative: malformed arguments, or entries
    whose index is out of ``[1, count]`` or already seen, are dropped"""
    try:
        payload = Ranking.model_validate_json(arguments)
    except ValidationError:
        _LOG.warning("rerank submission did not validate; falling back to prefilter order")
        return []
    order: list[tuple[int, str | None]] = []
    seen: set[int] = set()
    for entry in payload.ranking:
        if not 1 <= entry.id <= count or entry.id - 1 in seen:
            _LOG.warning("rerank submission had an invalid entry; dropping")
            continue
        seen.add(entry.id - 1)
        why = entry.why.strip() if entry.why and entry.why.strip() else None
        order.append((entry.id - 1, why))
    return order
