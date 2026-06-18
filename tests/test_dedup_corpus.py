"""Regression test built from a real run's corpus.

A live run over "русскоязычный стендап в Берлине" stored 15 raw candidates and
produced 15 canonical results — it merged nothing, even though five real-world
events each appear twice (once per ticket source, in different languages). The
fixture (`tests/fixtures/dedup_raw_results.json`) is those 15 raw rows paired
with the *actual* 384-d embeddings the run computed, so the failure replays
deterministically without the network.

The five true duplicate pairs share an identical start time and venue but their
titles/descriptions diverge across sources and languages, so the text signals
(MinHash lexical + embedding cosine) land below the tiebreak band on their own.
The fix is the venue+start-time identity signal: it routes those five pairs to
the batched tiebreak judge (one `submit_verdicts` call for the whole run), which
confirms them. The gold corpus is 10 canonicals: 5 merged pairs + 5 singles.
"""

from __future__ import annotations

import json
import re
from collections.abc import Sequence
from pathlib import Path

from events_curator.dedup import ThresholdDeduper
from events_curator.dedup._golden import doc_text
from events_curator.dedup._judge import DuplicateVerdicts, PairVerdict
from events_curator.llm import ChatMessage
from events_curator.models import CanonicalSearchResultId, RawSearchResult, Vector
from events_curator.storage import InMemoryStorage

_FIXTURE = Path(__file__).parent / "fixtures" / "dedup_raw_results.json"

# Pairs of source URLs that describe the same real-world event (same venue + start
# time, different ticket site/language). Each pair must collapse to one canonical.
_DUPLICATE_PAIRS = [
    (
        "https://kontramarka.de/tour/a-chto-sluchilos",
        "https://biletkartina.tv/ru/event/Sasa_Dolgopolov_i_Lesa_Suplakov_v_Berline_Komedijnoe_sou_A_cto_slucilos",
    ),
    (
        "https://kontramarka.de/tour/pasha-zalutskiy",
        "https://biletkartina.tv/ru/event/Pasa_Zaluckij_i_Druz_a_v_Berline",
    ),
    (
        "https://kontramarka.de/tour/irina-prihodko",
        "https://biletkartina.tv/ru/event/Irina_Prihod_ko_Evropejskij_tur_2026",
    ),
    (
        "https://kontramarka.de/tour/mihail-shats",
        "https://biletkartina.tv/ru/event/Mihail_Sac_v_Evrope_Stendap_tur",
    ),
    (
        "https://worldafisha.com/event/bogdan-lisevskiy-berlin-2026-11-10",
        "https://worldafisha.com/events/berlin",
    ),
]

# 15 raw candidates - 5 merged pairs = 10 distinct golden records.
_GOLD_CANONICAL_COUNT = 10


def _load_corpus() -> tuple[list[RawSearchResult], dict[str, Vector]]:
    records = json.loads(_FIXTURE.read_text())
    raws = [RawSearchResult.model_validate(r["raw"]) for r in records]
    embedding_by_doc = {
        doc_text(raw): record["embedding"] for raw, record in zip(raws, records, strict=True)
    }
    return raws, embedding_by_doc


class ReplayEmbedder:
    """Returns each candidate's recorded embedding, keyed by its doc text — the
    real vectors from the run, so similarity scores match production exactly."""

    def __init__(self, by_doc: dict[str, Vector]) -> None:
        self._by_doc = by_doc
        self.calls = 0

    async def embed(self, texts: Sequence[str]) -> list[Vector]:
        self.calls += 1
        return [self._by_doc[text] for text in texts]


class AcceptingJudge:
    """Stands in for the LLM tiebreak judge and confirms every numbered pair via the
    batched submit-tool. The venue+time signal routes the five cross-source pairs
    here; the judge confirms them and they collapse."""

    def __init__(self) -> None:
        self.calls = 0

    async def complete(
        self, messages: Sequence[ChatMessage], *, model: str, temperature: float = 0.0
    ) -> str:
        del messages, model, temperature
        raise NotImplementedError  # the judge answers via submit only

    async def submit(
        self,
        messages: Sequence[ChatMessage],
        *,
        tool: dict[str, object],
        model: str,
        temperature: float = 0.0,
    ) -> str:
        del tool, model, temperature
        self.calls += 1
        pairs = [int(n) for n in re.findall(r"Pair (\d+):", messages[1].content)]
        return DuplicateVerdicts(
            verdicts=[PairVerdict(pair=n, same=True) for n in pairs]
        ).model_dump_json()


def _deduper(embedder: ReplayEmbedder, judge: AcceptingJudge) -> ThresholdDeduper:
    return ThresholdDeduper(
        embedder,
        judge,
        system_prompt="judge",
        model="test-model",
        auto_merge_threshold=0.88,
        tiebreak_low_threshold=0.75,
        block_window_days=1,
        block_limit=10,
    )


async def _reconcile() -> tuple[dict[str, CanonicalSearchResultId | None], AcceptingJudge]:
    raws, embedding_by_doc = _load_corpus()
    store = InMemoryStorage().results
    judge = AcceptingJudge()
    outcomes = await _deduper(ReplayEmbedder(embedding_by_doc), judge).reconcile(raws, store)
    landed_by_url = {o.candidate.url: o.canonical_search_result_id for o in outcomes}
    return landed_by_url, judge


async def test_real_corpus_collapses_cross_source_duplicates() -> None:
    landed_by_url, _ = await _reconcile()

    for first_url, second_url in _DUPLICATE_PAIRS:
        assert landed_by_url[first_url] is not None
        assert landed_by_url[first_url] == landed_by_url[second_url], (
            f"{first_url} and {second_url} are the same event but landed in different canonicals"
        )

    distinct = {cid for cid in landed_by_url.values() if cid is not None}
    assert len(distinct) == _GOLD_CANONICAL_COUNT


async def test_real_corpus_resolves_all_pairs_in_one_judge_call() -> None:
    """The whole run's venue+time matches are decided together — one batched
    `submit_verdicts` round-trip, not one LLM call per ambiguous pair."""
    _, judge = await _reconcile()
    assert judge.calls == 1
