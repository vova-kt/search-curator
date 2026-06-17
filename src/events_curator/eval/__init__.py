"""Eval module door: cases, metrics, runner, and report."""

from __future__ import annotations

from events_curator.eval.metrics import MRR, PrecisionAtK, RecallAtK
from events_curator.eval.protocols import EvalCase, FixtureRepository, Metric, PredictFn
from events_curator.eval.report import CaseResult, EvalReport
from events_curator.eval.runner import EvalRunner

__all__ = [
    "MRR",
    "CaseResult",
    "EvalCase",
    "EvalReport",
    "EvalRunner",
    "FixtureRepository",
    "Metric",
    "PrecisionAtK",
    "PredictFn",
    "RecallAtK",
]
