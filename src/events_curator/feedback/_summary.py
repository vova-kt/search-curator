"""The profile-summarizer's prompt/parse contract, kept dependency-free (no LLM
adapter) so it is unit-testable without the ``llm`` extra — mirrors
``dedup/_judge.py``. The system instruction is passed in (resolved from config per
``LLMRole.FEEDBACK_SUMMARY``); this module assembles the user message: the search's
current taste summary and one fresh like/dislike (with the item and the user's
optional free-text reason), asking the model to return a short, rewritten summary
that folds the new signal in. Free text, not JSON — the summary is read back
verbatim."""

from __future__ import annotations

from events_curator.enums import FeedbackKind
from events_curator.llm import ChatMessage
from events_curator.models import CanonicalSearchResult, Feedback


def build_summary_prompt(
    system: str, current_summary: str, feedback: Feedback, result: CanonicalSearchResult
) -> list[ChatMessage]:
    verb = "LIKED" if feedback.kind is FeedbackKind.LIKE else "DISLIKED"
    attrs = (
        ", ".join(f"{k}={v}" for k, v in result.attributes.items()) if result.attributes else "none"
    )
    current = current_summary.strip() or "(nothing learned yet)"
    body = (
        f"Current description:\n{current}\n\n"
        f"New signal — the user {verb} this result:\n"
        f"title: {result.title}\n"
        f"description: {result.description or 'none'}\n"
        f"city: {result.geo.city or 'unknown'}; attributes: {attrs}\n"
        f"reason: {feedback.reason or 'none given'}\n\n"
        "Return the updated description."
    )
    return [
        ChatMessage(role="system", content=system),
        ChatMessage(role="user", content=body),
    ]


def parse_summary(reply: str) -> str:
    """Read the model's reply back as the new summary — verbatim but trimmed."""
    return reply.strip()


__all__ = ["build_summary_prompt", "parse_summary"]
