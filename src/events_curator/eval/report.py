"""Eval results: per-case metric scores and the aggregate report."""

from __future__ import annotations

from pydantic import BaseModel, Field

from events_curator.enums import RunMode, Stage


class CaseResult(BaseModel):
    case_name: str
    metric_scores: dict[str, float] = Field(default_factory=dict[str, float])


class EvalReport(BaseModel):
    stage: Stage
    mode: RunMode = RunMode.EVAL
    results: list[CaseResult] = Field(default_factory=list[CaseResult])

    def summary(self) -> dict[str, float]:
        """Mean of each metric across cases."""
        totals: dict[str, float] = {}
        counts: dict[str, int] = {}
        for result in self.results:
            for metric, value in result.metric_scores.items():
                totals[metric] = totals.get(metric, 0.0) + value
                counts[metric] = counts.get(metric, 0) + 1
        return {metric: totals[metric] / counts[metric] for metric in totals}
