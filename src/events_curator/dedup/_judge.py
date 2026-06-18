"""The tiebreak judge's prompt/submit contract, kept dependency-free (no LLM
adapter) so it is unit-testable without the ``llm`` extra — mirrors
``search/_extract.py``. Only pairs whose similarity lands in the ambiguous band
between the two thresholds, *or* that share a venue+start-time, ever reach the
judge.

The judge is **batched**: one run's ambiguous pairs are decided in a single
submit-tool call (the `submit_verdicts` function), so reconciliation spends one
LLM round-trip per run rather than one per pair. The verdict shape is generated
from `DuplicateVerdicts`, so the model returns typed per-pair booleans instead of
free-form prose. The system instruction is passed in (resolved from config per
`LLMRole.DEDUP_JUDGE`); this module assembles the numbered pairs and reads the
typed reply.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence

from pydantic import BaseModel, Field, ValidationError

from events_curator.enums import Stage
from events_curator.llm import ChatMessage
from events_curator.models import CanonicalSearchResult, RawSearchResult

_LOG = logging.getLogger(f"events_curator.stage.{Stage.DEDUP.value}")

# A pair is (fresh candidate, the canonical it may duplicate).
JudgePair = tuple[RawSearchResult, CanonicalSearchResult]

SUBMIT_TOOL_NAME = "submit_verdicts"
_SUBMIT_TOOL_DESCRIPTION = (
    "Submit one verdict per numbered pair. Call this once, with exactly one entry "
    "for each pair, saying whether the two records are the same real-world item."
)


class PairVerdict(BaseModel):
    pair: int = Field(description="1-based number of the pair being judged.")
    same: bool = Field(
        description="True if the two records describe the SAME real-world item, else false."
    )


class DuplicateVerdicts(BaseModel):
    verdicts: list[PairVerdict] = Field(
        default_factory=list[PairVerdict],
        description="One entry per numbered pair.",
    )


def submit_tool() -> dict[str, object]:
    """The `submit_verdicts` function-tool spec; its parameters schema is generated
    from `DuplicateVerdicts` so the per-pair verdict shape stays single-sourced."""
    return {
        "type": "function",
        "function": {
            "name": SUBMIT_TOOL_NAME,
            "description": _SUBMIT_TOOL_DESCRIPTION,
            "parameters": DuplicateVerdicts.model_json_schema(),
            "strict": False,
        },
    }


def _render(label: str, record: RawSearchResult | CanonicalSearchResult) -> str:
    when = record.starts_at.date().isoformat() if record.starts_at else "unknown"
    return (
        f"  [{label}]\n"
        f"  title: {record.title}\n"
        f"  description: {record.description}\n"
        f"  date: {when}\n"
        f"  city: {record.geo.city or 'unknown'}\n"
        f"  venue: {record.geo.venue or 'unknown'}\n"
        f"  url: {record.url}"
    )


def build_judge_prompt(system: str, pairs: Sequence[JudgePair]) -> list[ChatMessage]:
    blocks = [
        f"Pair {i}:\n{_render('A', candidate)}\n\n{_render('B', other)}"
        for i, (candidate, other) in enumerate(pairs, start=1)
    ]
    body = (
        "For each numbered pair, decide whether A and B describe the SAME "
        "real-world item (the same event, paper, listing, …) even if their titles, "
        "wording, language, or URLs differ.\n\n"
        + "\n\n".join(blocks)
        + f"\n\nCall {SUBMIT_TOOL_NAME} with one verdict per pair."
    )
    return [
        ChatMessage(role="system", content=system),
        ChatMessage(role="user", content=body),
    ]


def parse_verdicts(arguments: str, *, count: int) -> dict[int, bool]:
    """Read the `submit_verdicts` call into a ``{0-based pair index: same?}`` map.
    Parsed conservatively, because a wrong merge corrupts the golden record while a
    missed one is recovered next run: a malformed payload yields ``{}`` (every pair
    treated as distinct), and out-of-range or duplicate pair numbers are dropped. A
    pair the model omits is absent from the map, which the caller reads as distinct."""
    try:
        payload = DuplicateVerdicts.model_validate_json(arguments)
    except ValidationError:
        _LOG.warning("dedup judge reply did not validate; treating all pairs as distinct")
        return {}
    verdicts: dict[int, bool] = {}
    for entry in payload.verdicts:
        index = entry.pair - 1
        if not 0 <= index < count or index in verdicts:
            _LOG.warning("dedup judge returned an invalid pair number %d; dropping", entry.pair)
            continue
        verdicts[index] = entry.same
    return verdicts


__all__ = [
    "SUBMIT_TOOL_NAME",
    "DuplicateVerdicts",
    "JudgePair",
    "PairVerdict",
    "build_judge_prompt",
    "parse_verdicts",
    "submit_tool",
]
