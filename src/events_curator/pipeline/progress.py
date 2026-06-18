"""The pipeline's observability contract: a `ProgressListener` the orchestrator
notifies as a run advances, so a UI can show what it is waiting for rather than a
blank spinner. The same events the per-stage loggers record are fanned out here,
so the trace an operator sees and the trace the logs keep stay in step.

The listener is called synchronously on the run's own task, in stage order, so it
must stay cheap and non-blocking — no network, no `await`. A run with no listener
is the common case (scheduler, eval); the orchestrator simply skips emission.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from events_curator.enums import ProgressPhase, Stage


@dataclass(frozen=True)
class ProgressEvent:
    """One observable step of a run. `detail` is a human-readable line ready to
    show verbatim; `stage` and `phase` let a richer UI group or decorate it (mark
    the live stage, tick off the finished ones)."""

    stage: Stage
    phase: ProgressPhase
    detail: str


class ProgressListener(Protocol):
    def on_progress(self, event: ProgressEvent) -> None: ...


__all__ = ["ProgressEvent", "ProgressListener"]
