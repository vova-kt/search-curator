"""The preference reranker's prompt/parse contract, kept dependency-free (no LLM
adapter) so it is unit-testable without the ``llm`` extra — mirrors
``dedup/_judge.py``. The system instruction is passed in (resolved from config per
``LLMRole.RANK_RERANKER``); this module assembles the user message: the search's
natural-language taste summary and the prefiltered candidates (as 1-based indices),
asking the model to order them best-first with a short reason each.

Candidates are addressed by small integer index rather than their uuid id: a model
echoes a short ordinal far more reliably than a 32-char hex, and the index maps
straight back to the prefiltered list. Parsing is conservative — entries with an
out-of-range or repeated index are dropped, and the ranker fills any indices the
model omitted, so a misbehaving reply can never lose or duplicate a candidate."""

from __future__ import annotations

import json
import re
from typing import cast

from events_curator.llm import ChatMessage
from events_curator.models import CanonicalSearchResult, SavedQuery

_FENCE = re.compile(r"\A```[a-zA-Z0-9]*\n(.*)\n```\Z", re.DOTALL)


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
        "Return the ranking JSON."
    )
    return [
        ChatMessage(role="system", content=system),
        ChatMessage(role="user", content=body),
    ]


def parse_rerank(reply: str, *, count: int) -> list[tuple[int, str | None]]:
    """Read the model's reply into an ordered list of ``(zero-based index, reason)``.
    Entries whose index is out of ``[1, count]`` or already seen are skipped; the
    caller appends any omitted indices to keep the ordering total."""
    order: list[tuple[int, str | None]] = []
    seen: set[int] = set()
    for entry in _entries(reply):
        index = entry.get("id")
        if not isinstance(index, int) or not 1 <= index <= count or index - 1 in seen:
            continue
        seen.add(index - 1)
        why = entry.get("why")
        order.append((index - 1, why.strip() if isinstance(why, str) and why.strip() else None))
    return order


def _entries(text: str) -> list[dict[str, object]]:
    try:
        payload: object = json.loads(_strip_fence(text))
    except json.JSONDecodeError:
        return []  # a bad reply falls back to the prefilter order, never crashes the run
    if isinstance(payload, dict):
        payload = cast("dict[str, object]", payload).get("ranking")
    if not isinstance(payload, list):
        return []
    rows = cast("list[object]", payload)
    return [cast("dict[str, object]", row) for row in rows if isinstance(row, dict)]


def _strip_fence(text: str) -> str:
    stripped = text.strip()
    match = _FENCE.match(stripped)
    return match.group(1) if match else stripped
