"""Ranking/retrieval metrics over ordered id lists. Pure and engine-agnostic, so
they apply to expand (predicted sub-queries), dedup (canonical ids), and rank
(ranked result ids) alike."""

from __future__ import annotations

from collections.abc import Sequence


class PrecisionAtK:
    def __init__(self, k: int) -> None:
        self.k = k
        self.name = f"precision@{k}"

    def score(self, predicted: Sequence[str], golden: Sequence[str]) -> float:
        if self.k <= 0:
            return 0.0
        top = predicted[: self.k]
        hits = len(set(top) & set(golden))
        return hits / self.k


class RecallAtK:
    def __init__(self, k: int) -> None:
        self.k = k
        self.name = f"recall@{k}"

    def score(self, predicted: Sequence[str], golden: Sequence[str]) -> float:
        if not golden:
            return 0.0
        top = predicted[: self.k]
        hits = len(set(top) & set(golden))
        return hits / len(set(golden))


class MRR:
    def __init__(self) -> None:
        self.name = "mrr"

    def score(self, predicted: Sequence[str], golden: Sequence[str]) -> float:
        golden_set = set(golden)
        for position, item in enumerate(predicted, start=1):
            if item in golden_set:
                return 1.0 / position
        return 0.0
