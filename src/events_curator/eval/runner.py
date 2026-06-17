"""Eval runner: apply a PredictFn to a stage's cases and score the predictions.

Cases are predicted concurrently (rule 5). The runner is deliberately ignorant
of *what* it's evaluating — wire `predict` to a single stage or to the whole
pipeline's ranked output.
"""

from __future__ import annotations

import asyncio
from collections.abc import Sequence

from events_curator.enums import Stage
from events_curator.eval.protocols import EvalCase, Metric, PredictFn
from events_curator.eval.report import CaseResult, EvalReport


class EvalRunner:
    def __init__(self, metrics: Sequence[Metric]) -> None:
        self._metrics = list(metrics)

    async def run(self, stage: Stage, cases: Sequence[EvalCase], predict: PredictFn) -> EvalReport:
        predictions = await asyncio.gather(*[predict(case) for case in cases])
        results = [
            CaseResult(
                case_name=case.name,
                metric_scores={m.name: m.score(pred, case.golden_ids) for m in self._metrics},
            )
            for case, pred in zip(cases, predictions, strict=True)
        ]
        return EvalReport(stage=stage, results=results)
