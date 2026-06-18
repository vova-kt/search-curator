"""Pick a saved query's attribute domain from its text.

The domain is what selects which `attributes` keys search offers the model (see
`search/attributes.py`). It's derived once per saved query and cached on
`SavedQuery.domain`, so this runs at most once per query, not once per run.

Like the other LLM call sites, the choice comes back as typed tool arguments (the
submit-tool pattern): the model calls `submit_domain` with one of the catalog's
domain names. Prompt/parse helpers are dependency-free (no LLM adapter) so they
unit-test without the network; `LLMDomainClassifier` drives an `LLMClient`.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Protocol

from pydantic import BaseModel, Field, ValidationError

from events_curator.enums import Stage
from events_curator.llm import ChatMessage, LLMClient
from events_curator.search.attributes import FALLBACK_DOMAIN, domain_descriptions

# Domain selection is query understanding, so its trace groups under the expand
# stage logger alongside the rest of "turn a saved query into searches".
_LOG = logging.getLogger(f"events_curator.stage.{Stage.EXPAND.value}")

SUBMIT_TOOL_NAME = "submit_domain"
_SUBMIT_TOOL_DESCRIPTION = (
    "Submit the single domain that best fits the search query. Call this once with "
    "exactly one of the offered domain names."
)


class DomainChoice(BaseModel):
    domain: str = Field(description="The chosen domain name, one of those offered.")


def classify_tool(domains: list[str]) -> dict[str, object]:
    """The `submit_domain` function-tool spec, constraining `domain` to the catalog's
    keys via a JSON-schema enum so the model can't return an unknown one."""
    return {
        "type": "function",
        "function": {
            "name": SUBMIT_TOOL_NAME,
            "description": _SUBMIT_TOOL_DESCRIPTION,
            "parameters": {
                "type": "object",
                "properties": {
                    "domain": {
                        "type": "string",
                        "enum": domains,
                        "description": "The best-fitting domain name.",
                    }
                },
                "required": ["domain"],
                "additionalProperties": False,
            },
            "strict": False,
        },
    }


def build_classify_prompt(
    system: str, text: str, descriptions: Mapping[str, str]
) -> list[ChatMessage]:
    catalog = "\n".join(f"- {name}: {desc}" for name, desc in descriptions.items())
    body = (
        f"Search query: {text}\n\n"
        f"Domains:\n{catalog}\n\n"
        f"Call {SUBMIT_TOOL_NAME} with the single best-fitting domain name."
    )
    return [
        ChatMessage(role="system", content=system),
        ChatMessage(role="user", content=body),
    ]


def parse_choice(arguments: str, *, allowed: set[str], fallback: str) -> str:
    """Read the `submit_domain` call's arguments. A malformed payload or a domain
    outside the catalog falls back to `fallback` (logged) rather than failing the run."""
    try:
        choice = DomainChoice.model_validate_json(arguments)
    except ValidationError:
        _LOG.warning("domain classification did not validate; using fallback %r", fallback)
        return fallback
    if choice.domain not in allowed:
        _LOG.warning(
            "classifier chose unknown domain %r; using fallback %r", choice.domain, fallback
        )
        return fallback
    return choice.domain


class DomainClassifier(Protocol):
    async def classify(self, text: str) -> str: ...


class LLMDomainClassifier(DomainClassifier):
    def __init__(
        self, llm: LLMClient, *, system_prompt: str, model: str, temperature: float = 0.0
    ) -> None:
        self._llm = llm
        self._system_prompt = system_prompt
        self._model = model
        self._temperature = temperature

    async def classify(self, text: str) -> str:
        descriptions = domain_descriptions()
        prompt = build_classify_prompt(self._system_prompt, text, descriptions)
        arguments = await self._llm.submit(
            prompt,
            tool=classify_tool(list(descriptions)),
            model=self._model,
            temperature=self._temperature,
        )
        domain = parse_choice(arguments, allowed=set(descriptions), fallback=FALLBACK_DOMAIN)
        _LOG.info("classified query domain as %r", domain)
        return domain
