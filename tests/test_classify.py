"""Domain classification picks a saved query's attribute domain via the submit-tool
pattern: the model calls `submit_domain` with one catalog key. The prompt/parse
helpers are dependency-free; `LLMDomainClassifier` drives an `LLMClient` and falls
back to `FALLBACK_DOMAIN` on a malformed or out-of-catalog choice."""

from __future__ import annotations

import json

from events_curator.search import DOMAIN_ATTRIBUTES, FALLBACK_DOMAIN, LLMDomainClassifier
from events_curator.search._classify import (
    SUBMIT_TOOL_NAME,
    build_classify_prompt,
    classify_tool,
    parse_choice,
)


class FakeClassifierLLM:
    """Returns a preset submit-tool reply and records the prompts it saw."""

    def __init__(self, reply: str) -> None:
        self._reply = reply
        self.calls = 0
        self.tools: list[dict[str, object]] = []

    async def submit(
        self, messages: object, *, tool: dict[str, object], model: str, temperature: float = 0.0
    ) -> str:
        del messages, model, temperature
        self.calls += 1
        self.tools.append(tool)
        return self._reply

    async def complete(self, messages: object, *, model: str, temperature: float = 0.0) -> str:
        del messages, model, temperature
        raise NotImplementedError  # the classifier answers via submit only


def _choice(domain: str) -> str:
    return json.dumps({"domain": domain})


# --- tool + prompt ---------------------------------------------------------


def test_classify_tool_constrains_domain_to_an_enum() -> None:
    tool = classify_tool(["events", "papers"])
    params = tool["function"]["parameters"]  # type: ignore[index]
    assert tool["function"]["name"] == SUBMIT_TOOL_NAME  # type: ignore[index]
    assert params["properties"]["domain"]["enum"] == ["events", "papers"]
    assert params["additionalProperties"] is False


def test_build_classify_prompt_lists_query_and_domains() -> None:
    messages = build_classify_prompt(
        "be a classifier", "jazz in berlin", {"events": "scheduled happenings"}
    )
    assert [m.role for m in messages] == ["system", "user"]
    assert messages[0].content == "be a classifier"
    assert "jazz in berlin" in messages[1].content
    assert "events: scheduled happenings" in messages[1].content


# --- parse_choice ----------------------------------------------------------


def test_parse_choice_returns_a_valid_domain() -> None:
    assert parse_choice(_choice("papers"), allowed={"events", "papers"}, fallback="events") == (
        "papers"
    )


def test_parse_choice_falls_back_on_unknown_domain() -> None:
    assert parse_choice(_choice("aliens"), allowed={"events"}, fallback="events") == "events"


def test_parse_choice_falls_back_on_malformed_arguments() -> None:
    assert parse_choice("not json", allowed={"events"}, fallback="events") == "events"
    assert parse_choice("{}", allowed={"events"}, fallback="events") == "events"


# --- LLMDomainClassifier ---------------------------------------------------


async def _classify(reply: str) -> tuple[str, FakeClassifierLLM]:
    llm = FakeClassifierLLM(reply)
    classifier = LLMDomainClassifier(llm, system_prompt="classify", model="test-model")
    domain = await classifier.classify("a query")
    return domain, llm


async def test_classifier_returns_the_models_choice() -> None:
    domain, llm = await _classify(_choice("papers"))
    assert domain == "papers"
    assert llm.calls == 1
    # The tool offered exactly the catalog's domains (in catalog order) as its enum.
    assert llm.tools[0] == classify_tool(list(DOMAIN_ATTRIBUTES))


async def test_classifier_falls_back_when_model_returns_unknown_domain() -> None:
    domain, _ = await _classify(_choice("not_a_domain"))
    assert domain == FALLBACK_DOMAIN
