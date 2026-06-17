"""The tiebreak judge's prompt/parse contract, kept dependency-free (no LLM
adapter) so it is unit-testable without the ``llm`` extra — mirrors
``search/_extract.py``. Only candidates whose similarity lands in the ambiguous
band between the two thresholds ever reach the judge."""

from __future__ import annotations

from events_curator.llm import ChatMessage
from events_curator.models import CanonicalSearchResult, RawSearchResult

_SYSTEM = (
    "You are a deduplication judge for search results. Two records are shown. "
    "Decide whether they describe the SAME real-world item (the same event, paper, "
    "listing, etc.) even if their titles, wording, or URLs differ. "
    "Reply with exactly 'yes' or 'no'."
)


def _render(label: str, record: RawSearchResult | CanonicalSearchResult) -> str:
    when = record.starts_at.date().isoformat() if record.starts_at else "unknown"
    return (
        f"[{label}]\n"
        f"title: {record.title}\n"
        f"description: {record.description}\n"
        f"date: {when}\n"
        f"city: {record.geo.city or 'unknown'}\n"
        f"venue: {record.geo.venue or 'unknown'}\n"
        f"url: {record.url}"
    )


def build_judge_prompt(
    candidate: RawSearchResult, other: CanonicalSearchResult
) -> list[ChatMessage]:
    body = f"{_render('A', candidate)}\n\n{_render('B', other)}\n\nSame item?"
    return [
        ChatMessage(role="system", content=_SYSTEM),
        ChatMessage(role="user", content=body),
    ]


def parse_judge_verdict(reply: str) -> bool:
    """Read the judge's reply as same-item (True) or distinct (False). Anything
    that is not a clear affirmative is treated as distinct: a missed merge is
    recovered on the next run, but a wrong merge corrupts the golden record."""
    return reply.strip().casefold().startswith(("yes", "same", "true"))
