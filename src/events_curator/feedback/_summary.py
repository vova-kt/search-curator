"""The profile-summarizer's prompt/parse contract, kept dependency-free (no LLM
adapter) so it is unit-testable without the ``llm`` extra — mirrors
``dedup/_judge.py``. The model is shown the search's current taste summary and one
fresh like/dislike (with the item and the user's optional free-text reason), and
asked to return a short, rewritten summary that folds the new signal in. Free text,
not JSON — the summary is read back verbatim."""

from __future__ import annotations

from events_curator.enums import FeedbackKind
from events_curator.llm import ChatMessage
from events_curator.models import CanonicalSearchResult, Feedback

_SYSTEM = (
    "You maintain a short natural-language description of what one recurring web "
    "search likes and dislikes. You are given the current description and one new "
    "like or dislike. Rewrite the description so it accounts for the new signal: keep "
    "it to a few sentences, concrete, and even-handed about likes and dislikes. Reply "
    "with ONLY the updated description — no preamble, no quotes."
)


def build_summary_prompt(
    current_summary: str, feedback: Feedback, result: CanonicalSearchResult
) -> list[ChatMessage]:
    verb = "LIKED" if feedback.kind is FeedbackKind.LIKE else "DISLIKED"
    tags = ", ".join(result.tags) if result.tags else "none"
    current = current_summary.strip() or "(nothing learned yet)"
    body = (
        f"Current description:\n{current}\n\n"
        f"New signal — the user {verb} this result:\n"
        f"title: {result.title}\n"
        f"description: {result.description or 'none'}\n"
        f"city: {result.geo.city or 'unknown'}; tags: {tags}\n"
        f"reason: {feedback.reason or 'none given'}\n\n"
        "Return the updated description."
    )
    return [
        ChatMessage(role="system", content=_SYSTEM),
        ChatMessage(role="user", content=body),
    ]


def parse_summary(reply: str) -> str:
    """Read the model's reply back as the new summary — verbatim but trimmed."""
    return reply.strip()


__all__ = ["build_summary_prompt", "parse_summary"]
