"""Eval ports. A case carries an input (a saved query) and the golden ordered
ids/strings expected out of a stage. Metrics score a predicted ordered list
against the golden. A `FixtureRepository` loads cases (from disk, golden files,
etc.). The thing under test is supplied as a `PredictFn`, so the same harness
evaluates any stage or the whole pipeline."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from typing import Protocol

from pydantic import BaseModel, Field

from events_curator.enums import Stage
from events_curator.models import SavedQuery


class EvalCase(BaseModel):
    name: str
    stage: Stage
    query: SavedQuery | None = None
    golden_ids: list[str] = Field(default_factory=list[str])


# Produces a stage/pipeline's predicted ordered ids (or strings) for one case.
PredictFn = Callable[[EvalCase], Awaitable[list[str]]]


class Metric(Protocol):
    name: str

    def score(self, predicted: Sequence[str], golden: Sequence[str]) -> float: ...


class FixtureRepository(Protocol):
    def cases(self, stage: Stage) -> list[EvalCase]: ...
