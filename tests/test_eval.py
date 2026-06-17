"""Eval metrics on ordered id lists, and the runner that scores a PredictFn's
predictions concurrently into a report."""

from __future__ import annotations

from events_curator.enums import Stage
from events_curator.eval import MRR, EvalCase, EvalRunner, PrecisionAtK, RecallAtK


def test_precision_at_k() -> None:
    metric = PrecisionAtK(2)
    assert metric.score(["a", "b", "c"], ["a", "z"]) == 0.5


def test_recall_at_k() -> None:
    metric = RecallAtK(3)
    assert metric.score(["a", "b", "x"], ["a", "b"]) == 1.0


def test_mrr_uses_first_hit_rank() -> None:
    assert MRR().score(["x", "a", "b"], ["a"]) == 0.5
    assert MRR().score(["x", "y"], ["a"]) == 0.0


async def test_runner_summarizes_mean_per_metric() -> None:
    cases = [
        EvalCase(name="c1", stage=Stage.RANK, golden_ids=["a"]),
        EvalCase(name="c2", stage=Stage.RANK, golden_ids=["b"]),
    ]
    predictions = {"c1": ["a"], "c2": ["z"]}

    async def predict(case: EvalCase) -> list[str]:
        return predictions[case.name]

    report = await EvalRunner([MRR()]).run(Stage.RANK, cases, predict)

    assert report.stage is Stage.RANK
    assert len(report.results) == 2
    # c1 hits at rank 1 (1.0), c2 misses (0.0) -> mean 0.5
    assert report.summary()["mrr"] == 0.5
