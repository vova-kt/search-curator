"""Expand stage: turn a SavedQuery into the concrete web queries to run.

The interesting variant is multi-query fan-out (one LLM call → N sub-queries),
which is what makes ChatGPT/Claude search feel good. The shipped fan-out is
`LLMQueryExpander`: it translates one saved query into per-language searches so a
"русский стендап в париже" is searched in French (the country where it happens),
Russian (named in the query), and English. `IdentityExpander` is the no-LLM stub
that returns the user's text unchanged — handy for tests and offline runs.

Like the other LLM call sites, the choice comes back as typed tool arguments (the
submit-tool pattern): the model calls `submit_queries` with one entry per language.
The prompt/tool/parse helpers below are dependency-free (no LLM adapter), so they
unit-test without the network; `LLMQueryExpander` drives an `LLMClient`.
"""

from __future__ import annotations

import logging
from typing import Protocol

from pydantic import BaseModel, Field, ValidationError

from events_curator.enums import Stage
from events_curator.llm import ChatMessage, LLMClient
from events_curator.models import ExpandedQuery, ExpandedQuerySet, SavedQuery

_LOG = logging.getLogger(f"events_curator.stage.{Stage.EXPAND.value}")

SUBMIT_TOOL_NAME = "submit_queries"
_SUBMIT_TOOL_DESCRIPTION = (
    "Submit the query translated into each applicable language. Call this once, "
    "with one entry per distinct target language."
)


class Expander(Protocol):
    async def expand(self, query: SavedQuery) -> ExpandedQuerySet: ...


class IdentityExpander(Expander):
    """STUB: user query -> singleton list of user query. The no-LLM fallback."""

    async def expand(self, query: SavedQuery) -> ExpandedQuerySet:
        _LOG.debug(f"identity: expanding query id={query.id}")
        return ExpandedQuerySet(
            saved_query_id=query.id,
            queries=[ExpandedQuery(saved_query_id=query.id, text=query.text)],
        )


class TranslatedQuery(BaseModel):
    language: str = Field(description="The target language's English name, e.g. 'French'.")
    query: str = Field(description="The whole search query translated into that language.")


class QueryTranslations(BaseModel):
    queries: list[TranslatedQuery] = Field(
        default_factory=list[TranslatedQuery],
        description="One entry per distinct target language.",
    )


def submit_tool() -> dict[str, object]:
    """The `submit_queries` function-tool spec; its parameters schema is generated
    from `QueryTranslations` so the per-language list shape stays single-sourced."""
    return {
        "type": "function",
        "function": {
            "name": SUBMIT_TOOL_NAME,
            "description": _SUBMIT_TOOL_DESCRIPTION,
            "parameters": QueryTranslations.model_json_schema(),
            "strict": False,
        },
    }


def build_expand_prompt(
    system: str, text: str, *, city: str | None, country: str | None
) -> list[ChatMessage]:
    where = ", ".join(part for part in (city, country) if part) or "unspecified"
    body = (
        f"Search query: {text}\n"
        f"Where the results happen (if known): {where}\n\n"
        "Translate the whole query into each of these languages, then deduplicate so "
        "each distinct language appears once:\n"
        "1. The primary language of the country where the results take place.\n"
        "2. Any language named or implied by the query itself "
        "(e.g. 'Russian stand-up' -> Russian).\n"
        "3. English.\n\n"
        f"Call {SUBMIT_TOOL_NAME} with one entry per distinct language. Translate "
        "naturally; leave proper nouns that shouldn't be translated as they are."
    )
    return [
        ChatMessage(role="system", content=system),
        ChatMessage(role="user", content=body),
    ]


def parse_queries(arguments: str) -> list[tuple[str, str]]:
    """Read the `submit_queries` call's arguments into `(language, query)` pairs,
    deduped case-insensitively by query text and dropping blanks. A malformed payload
    returns empty so the caller can fall back to the original query text."""
    try:
        payload = QueryTranslations.model_validate_json(arguments)
    except ValidationError:
        _LOG.warning("query expansion did not validate; falling back to the original query")
        return []
    pairs: list[tuple[str, str]] = []
    seen: set[str] = set()
    for entry in payload.queries:
        query = entry.query.strip()
        key = query.casefold()
        if not query or key in seen:
            continue
        seen.add(key)
        pairs.append((entry.language.strip() or "unknown", query))
    return pairs


class LLMQueryExpander(Expander):
    """Multi-query fan-out by translation: one `submit_queries` call returns the saved
    query rendered in the country's language, any language named in the query, and
    English. Falls back to the original text if the model returns nothing usable."""

    def __init__(
        self, llm: LLMClient, *, system_prompt: str, model: str, temperature: float = 0.0
    ) -> None:
        self._llm = llm
        self._system_prompt = system_prompt
        self._model = model
        self._temperature = temperature

    async def expand(self, query: SavedQuery) -> ExpandedQuerySet:
        prompt = build_expand_prompt(
            self._system_prompt, query.text, city=query.city, country=query.country
        )
        arguments = await self._llm.submit(
            prompt, tool=submit_tool(), model=self._model, temperature=self._temperature
        )
        pairs = parse_queries(arguments) or [("original", query.text)]
        languages = ", ".join(language for language, _ in pairs)
        _LOG.info("expanded query %s into %d search(es): %s", query.id, len(pairs), languages)
        return ExpandedQuerySet(
            saved_query_id=query.id,
            queries=[ExpandedQuery(saved_query_id=query.id, text=text) for _, text in pairs],
        )


__all__ = [
    "SUBMIT_TOOL_NAME",
    "Expander",
    "IdentityExpander",
    "LLMQueryExpander",
    "QueryTranslations",
    "TranslatedQuery",
    "build_expand_prompt",
    "parse_queries",
    "submit_tool",
]
