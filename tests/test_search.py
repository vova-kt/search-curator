from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any, cast

import pytest

from events_curator.enums import SearchEngineKind
from events_curator.models import ExpandedQuery, GeoBias, new_saved_query_id
from events_curator.search import (
    ExtractedResult,
    FrontierWebSearch,
    canonicalize_url,
)
from events_curator.search._extract import (
    SUBMIT_TOOL_NAME,
    build_search_prompt,
    parse_submission,
    submit_tool,
)


class _Backend:
    def __init__(self, rows: list[ExtractedResult]) -> None:
        self._rows = rows
        self.calls: list[tuple[str, int]] = []
        self.locations: list[GeoBias] = []
        self.domains: list[str] = []

    async def find(
        self, query: str, *, max_results: int, location: GeoBias, domain: str
    ) -> list[ExtractedResult]:
        self.calls.append((query, max_results))
        self.locations.append(location)
        self.domains.append(domain)
        return self._rows


def _query(text: str = "jazz in berlin") -> ExpandedQuery:
    return ExpandedQuery(saved_query_id=new_saved_query_id(), text=text)


async def test_engine_maps_rows_to_raw_results() -> None:
    query = _query()
    backend = _Backend(
        [
            ExtractedResult(
                url="https://www.Example.com/show/?utm_source=fb#frag",
                title="A Show",
                description="late set",
                starts_at=datetime(2026, 7, 1, 20, tzinfo=UTC),
                city="Berlin",
                country="DE",
                venue="A-Trane",
                image_url="https://example.com/poster.jpg",
                attributes={"genre": "jazz", "organizer": "A-Trane"},
                price="15€",
            )
        ]
    )
    [result] = await FrontierWebSearch(backend).search(
        query, location=GeoBias(city="Berlin"), domain="events"
    )

    assert backend.calls == [("jazz in berlin", 20)]
    assert backend.locations == [GeoBias(city="Berlin")]  # the engine threads it to the backend
    assert backend.domains == ["events"]  # and the domain too
    assert result.source_query_id == query.id
    assert result.source_engine is SearchEngineKind.FRONTIER_NATIVE
    assert result.url == "https://example.com/show"  # www/tracking/fragment/slash gone
    assert result.geo.city == "Berlin"
    assert result.geo.venue == "A-Trane"
    assert result.image_url == "https://example.com/poster.jpg"
    assert result.attributes == {"genre": "jazz", "organizer": "A-Trane"}
    assert result.rank == 0


async def test_engine_ranks_contiguously_and_skips_blank_urls() -> None:
    backend = _Backend(
        [
            ExtractedResult(url="https://a.com", title="a"),
            ExtractedResult(url="   ", title="blank"),
            ExtractedResult(url="https://b.com", title="b"),
        ]
    )
    results = await FrontierWebSearch(backend).search(_query(), location=GeoBias(), domain="events")

    assert [(r.url, r.rank) for r in results] == [("https://a.com", 0), ("https://b.com", 1)]


async def test_engine_truncates_to_max_results() -> None:
    backend = _Backend([ExtractedResult(url=f"https://e.com/{i}", title=str(i)) for i in range(5)])
    results = await FrontierWebSearch(backend, max_results=2).search(
        _query(), location=GeoBias(), domain="events"
    )

    assert [r.rank for r in results] == [0, 1]
    assert backend.calls == [("jazz in berlin", 2)]


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("https://WWW.Example.COM/Path/", "https://example.com/Path"),
        ("https://example.com/?utm_medium=x&q=1&fbclid=z", "https://example.com/?q=1"),
        ("https://example.com:443/a", "https://example.com/a"),
        ("https://example.com:8080/a", "https://example.com:8080/a"),
        ("https://example.com/a#section", "https://example.com/a"),
        ("  https://example.com/a  ", "https://example.com/a"),
        ("mailto:hi@example.com", "mailto:hi@example.com"),
        ("not a url", "not a url"),
        ("", ""),
    ],
)
def test_canonicalize_url(raw: str, expected: str) -> None:
    assert canonicalize_url(raw) == expected


def test_submit_tool_schema_is_derived_from_extracted_result() -> None:
    tool = submit_tool({"organizer": "who runs it"})
    parameters = cast("dict[str, Any]", tool["parameters"])
    assert tool["type"] == "function"
    assert tool["name"] == SUBMIT_TOOL_NAME
    assert "results" in parameters["properties"]
    # The row shape is single-sourced from ExtractedResult, referenced via $defs.
    row_props = parameters["$defs"]["ExtractedResult"]["properties"]
    assert "attributes" in row_props
    assert "image_url" in row_props
    assert "tags" not in row_props  # dropped in favor of the configured attributes map


def test_submit_tool_narrows_attributes_to_configured_vocabulary() -> None:
    tool = submit_tool({"organizer": "who runs it", "genre": "music style"})
    parameters = cast("dict[str, Any]", tool["parameters"])
    attributes = parameters["$defs"]["ExtractedResult"]["properties"]["attributes"]
    # Only the configured keys are offered, each described by its instruction, and the
    # model may not invent others (the open string→string map is gone).
    assert attributes["additionalProperties"] is False
    assert set(attributes["properties"]) == {"organizer", "genre"}
    assert attributes["properties"]["organizer"]["description"] == "who runs it"
    assert attributes["properties"]["genre"]["type"] == "string"


def test_parse_submission_reads_results_array() -> None:
    arguments = '{"results": [{"url": "https://a.com", "title": "A"}]}'
    rows = parse_submission(arguments, max_results=10)
    assert [r.url for r in rows] == ["https://a.com"]


def test_parse_submission_skips_invalid_rows_and_truncates() -> None:
    arguments = (
        '{"results": ['
        '{"url": "https://a.com", "title": "A"},'
        '{"title": "no url"},'  # invalid: url is required -> skipped
        '"junk",'  # not an object -> skipped
        '{"url": "https://b.com", "title": "B"},'
        '{"url": "https://c.com", "title": "C"}'
        "]}"
    )
    rows = parse_submission(arguments, max_results=2)
    assert [r.url for r in rows] == ["https://a.com", "https://b.com"]


def test_parse_submission_without_results_array_is_empty() -> None:
    assert parse_submission('{"other": 1}', max_results=10) == []


def test_parse_submission_raises_on_malformed_arguments() -> None:
    with pytest.raises(json.JSONDecodeError):
        parse_submission("not json at all", max_results=10)


def test_build_search_prompt_fills_template() -> None:
    prompt = build_search_prompt(
        "Find up to {max_results} results for: {query}", "trail races", max_results=7
    )
    assert "trail races" in prompt
    assert "7" in prompt
