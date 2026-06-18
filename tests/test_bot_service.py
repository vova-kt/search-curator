"""The transport-neutral assistant core over InMemoryStorage. The pipeline is
stubbed so the service's own logic is what's under test: owner-only authorization,
cron validation on save, capping each run to `max_results_shown` and marking
exactly the delivered results shown, and the manual-vs-scheduled distinction
(manual runs don't advance `last_run_at`; scheduled, due ones do)."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest

from events_curator.apps.bot import AssistantService, InvalidScheduleError
from events_curator.auth import NotOwnerError, TelegramAuthenticator
from events_curator.enums import AuthScheme, FeedbackKind
from events_curator.llm import ChatMessage
from events_curator.models import (
    CanonicalSearchResult,
    CanonicalSearchResultId,
    Feedback,
    PreferenceProfile,
    Principal,
    Provenance,
    RankedSearchResult,
    SavedQuery,
    SavedQueryId,
    UserId,
)
from events_curator.pipeline import CurationPipeline, ProgressListener
from events_curator.search_builder import SearchBuilder, SearchDraft
from events_curator.storage import InMemoryStorage

_OWNER = UserId("tg:42")


class FakeLLM:
    """An `LLMClient` the search-builder can hold; only `submit` is exercised."""

    def __init__(self, reply: str = "") -> None:
        self._reply = reply

    async def submit(
        self, messages: object, *, tool: dict[str, object], model: str, temperature: float = 0.0
    ) -> str:
        del messages, tool, model, temperature
        return self._reply

    async def complete(self, messages: object, *, model: str, temperature: float = 0.0) -> str:
        del messages, model, temperature
        raise NotImplementedError


class FakePipeline:
    """Returns a preset ranked list and records how `run` was called, so capping /
    ledger / scheduling can be asserted without the real stages."""

    def __init__(self, ranked: list[RankedSearchResult] | None = None) -> None:
        self.ranked = ranked or []
        self.run_calls: list[tuple[SavedQueryId, bool]] = []
        self.feedbacks: list[Feedback] = []

    async def run(
        self,
        saved_query_id: SavedQueryId,
        principal: Principal,
        *,
        unseen_only: bool = False,
        on_progress: ProgressListener | None = None,
    ) -> list[RankedSearchResult]:
        del principal, on_progress
        self.run_calls.append((saved_query_id, unseen_only))
        return self.ranked

    async def record_feedback(self, feedback: Feedback, principal: Principal) -> PreferenceProfile:
        del principal
        self.feedbacks.append(feedback)
        return PreferenceProfile(saved_query_id=feedback.saved_query_id)


def _service(
    storage: InMemoryStorage,
    pipeline: FakePipeline,
    *,
    llm_reply: str = "",
    owner_id: str = "42",
) -> AssistantService:
    builder = SearchBuilder(FakeLLM(llm_reply), system_prompt="build", model="m")
    return AssistantService(
        pipeline=cast(CurationPipeline, pipeline),
        storage=storage,
        authenticator=TelegramAuthenticator(),
        builder=builder,
        owner_id=owner_id,
    )


def _principal() -> Principal:
    return Principal(user_id=_OWNER, scheme=AuthScheme.TELEGRAM)


async def _seed_canonicals(storage: InMemoryStorage, ids: list[CanonicalSearchResultId]) -> None:
    for cid in ids:
        await storage.results.upsert_canonical(
            CanonicalSearchResult(id=cid, url=f"https://e/{cid}", title=cid),
            Provenance(canonical_search_result_id=cid),
        )


def _ranked(ids: list[CanonicalSearchResultId]) -> list[RankedSearchResult]:
    return [
        RankedSearchResult(canonical_search_result_id=cid, score=float(len(ids) - i), rank=i)
        for i, cid in enumerate(ids)
    ]


# --- authorization ---------------------------------------------------------


async def test_authorize_owner_returns_principal_and_creates_user() -> None:
    storage = InMemoryStorage()
    service = _service(storage, FakePipeline())

    principal = await service.authorize("42")

    assert principal is not None
    assert principal.user_id == _OWNER
    assert (await storage.users.get(_OWNER)) is not None


async def test_authorize_rejects_a_non_owner_chat() -> None:
    service = _service(InMemoryStorage(), FakePipeline())
    assert await service.authorize("999") is None


async def test_authorize_with_blank_owner_config_never_authorizes() -> None:
    service = _service(InMemoryStorage(), FakePipeline(), owner_id="")
    assert await service.authorize("") is None


# --- new-search dialogue ---------------------------------------------------


async def test_build_turn_drives_the_builder() -> None:
    reply = json.dumps({"message": "Here it is:", "ready": True, "text": "jazz"})
    service = _service(InMemoryStorage(), FakePipeline(), llm_reply=reply)

    turn = await service.build_turn([ChatMessage(role="user", content="jazz weekly")])

    assert turn.draft is not None
    assert turn.draft.text == "jazz"


# --- save / list / delete --------------------------------------------------


async def test_save_search_persists_a_valid_cron() -> None:
    storage = InMemoryStorage()
    service = _service(storage, FakePipeline())
    draft = SearchDraft(
        text="jazz",
        city="Berlin",
        schedule_cron="0 9 * * 1",
        schedule_text="weekly",
        max_results_shown=5,
    )

    saved = await service.save_search(_principal(), draft)

    stored = await storage.queries.get(saved.id)
    assert stored is not None
    assert (stored.text, stored.city, stored.schedule_cron) == ("jazz", "Berlin", "0 9 * * 1")
    assert stored.max_results_shown == 5


async def test_save_search_treats_a_blank_cron_as_manual() -> None:
    service = _service(InMemoryStorage(), FakePipeline())
    saved = await service.save_search(_principal(), SearchDraft(text="jazz", schedule_cron="   "))
    assert saved.schedule_cron is None


async def test_save_search_rejects_an_invalid_cron() -> None:
    service = _service(InMemoryStorage(), FakePipeline())
    with pytest.raises(InvalidScheduleError):
        await service.save_search(
            _principal(), SearchDraft(text="jazz", schedule_cron="not a cron")
        )


async def test_list_searches_returns_only_the_principals_queries() -> None:
    storage = InMemoryStorage()
    service = _service(storage, FakePipeline())
    mine = SavedQuery(user_id=_OWNER, text="jazz")
    await storage.queries.upsert(mine)
    await storage.queries.upsert(SavedQuery(user_id=UserId("tg:99"), text="papers"))

    listed = await service.list_searches(_principal())

    assert [q.id for q in listed] == [mine.id]


async def test_delete_search_removes_an_owned_query() -> None:
    storage = InMemoryStorage()
    service = _service(storage, FakePipeline())
    query = SavedQuery(user_id=_OWNER, text="jazz")
    await storage.queries.upsert(query)

    await service.delete_search(_principal(), query.id)

    assert (await storage.queries.get(query.id)) is None


async def test_delete_search_rejects_someone_elses_query() -> None:
    storage = InMemoryStorage()
    service = _service(storage, FakePipeline())
    query = SavedQuery(user_id=UserId("tg:99"), text="jazz")
    await storage.queries.upsert(query)

    with pytest.raises(NotOwnerError):
        await service.delete_search(_principal(), query.id)


# --- runs ------------------------------------------------------------------


async def test_run_now_caps_to_max_results_and_marks_only_those_shown() -> None:
    storage = InMemoryStorage()
    ids = [CanonicalSearchResultId(f"c{i}") for i in range(3)]
    await _seed_canonicals(storage, ids)
    pipeline = FakePipeline(_ranked(ids))
    service = _service(storage, pipeline)
    query = SavedQuery(user_id=_OWNER, text="jazz", max_results_shown=2)
    await storage.queries.upsert(query)

    deliveries = await service.run_now(_principal(), query.id)

    assert [d.result.id for d in deliveries] == ids[:2]  # capped
    assert pipeline.run_calls == [(query.id, True)]  # unseen_only
    assert (await storage.results.shown_ids_for_user(_OWNER)) == set(ids[:2])


async def test_run_now_does_not_advance_the_schedule() -> None:
    storage = InMemoryStorage()
    ids = [CanonicalSearchResultId("c0")]
    await _seed_canonicals(storage, ids)
    service = _service(storage, FakePipeline(_ranked(ids)))
    query = SavedQuery(user_id=_OWNER, text="jazz", schedule_cron="0 9 * * *")
    await storage.queries.upsert(query)

    await service.run_now(_principal(), query.id)

    stored = await storage.queries.get(query.id)
    assert stored is not None
    assert stored.last_run_at is None  # manual runs are off-cycle


async def test_run_due_runs_only_due_queries_and_advances_last_run_at() -> None:
    storage = InMemoryStorage()
    ids = [CanonicalSearchResultId("c0")]
    await _seed_canonicals(storage, ids)
    pipeline = FakePipeline(_ranked(ids))
    service = _service(storage, pipeline)
    moment = datetime(2026, 6, 17, 12, 0, tzinfo=UTC)
    due = SavedQuery(
        user_id=_OWNER,
        text="due",
        schedule_cron="0 9 * * *",
        last_run_at=moment - timedelta(days=1),
    )
    not_due = SavedQuery(
        user_id=_OWNER, text="later", schedule_cron="0 9 * * *", last_run_at=moment
    )
    await storage.queries.upsert(due)
    await storage.queries.upsert(not_due)

    batches = await service.run_due(moment)

    assert len(batches) == 1
    assert batches[0].user_id == _OWNER
    assert pipeline.run_calls == [(due.id, True)]
    refreshed = await storage.queries.get(due.id)
    assert refreshed is not None
    assert refreshed.last_run_at == moment
    untouched = await storage.queries.get(not_due.id)
    assert untouched is not None
    assert untouched.last_run_at == moment  # unchanged: it wasn't due


async def test_run_due_returns_nothing_when_no_query_is_due() -> None:
    storage = InMemoryStorage()
    service = _service(storage, FakePipeline())
    moment = datetime(2026, 6, 17, 12, 0, tzinfo=UTC)
    await storage.queries.upsert(
        SavedQuery(user_id=_OWNER, text="later", schedule_cron="0 9 * * *", last_run_at=moment)
    )

    assert await service.run_due(moment) == []


# --- feedback --------------------------------------------------------------


async def test_record_feedback_delegates_to_the_pipeline() -> None:
    pipeline = FakePipeline()
    service = _service(InMemoryStorage(), pipeline)

    await service.record_feedback(
        _principal(),
        SavedQueryId("q1"),
        CanonicalSearchResultId("c1"),
        FeedbackKind.DISLIKE,
        reason="too far",
    )

    assert len(pipeline.feedbacks) == 1
    feedback = pipeline.feedbacks[0]
    assert feedback.saved_query_id == SavedQueryId("q1")
    assert feedback.kind is FeedbackKind.DISLIKE
    assert feedback.reason == "too far"
