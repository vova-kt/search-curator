"""Production entrypoint: a scheduler that periodically re-runs every enabled,
scheduled saved query through the pipeline. This is the long-running process the
Docker image launches.

It is intentionally thin — all real work lives in the pipeline. The scheduler
acts on behalf of each query's owner and isolates failures per query so one bad
run can't take the loop down.
"""

from __future__ import annotations

import asyncio
import logging

from events_curator.config import AppConfig, get_config
from events_curator.enums import AuthScheme
from events_curator.models import Principal, SavedQuery
from events_curator.pipeline import CurationPipeline, build_default_pipeline
from events_curator.storage import InMemoryStorage, Storage

log = logging.getLogger(__name__)


class SchedulerServer:
    def __init__(self, pipeline: CurationPipeline, storage: Storage, tick_seconds: int) -> None:
        self._pipeline = pipeline
        self._storage = storage
        self._tick_seconds = tick_seconds

    async def _run_one(self, query: SavedQuery) -> None:
        principal = Principal(user_id=query.user_id, scheme=AuthScheme.LOCAL)
        try:
            ranked = await self._pipeline.run(query.id, principal)
            log.info("ran saved query %s: %d results", query.id, len(ranked))
        except Exception:
            log.exception("saved query %s failed", query.id)

    async def tick(self) -> None:
        scheduled = await self._storage.queries.list_scheduled()
        # Rule 5: independent runs proceed concurrently.
        await asyncio.gather(*[self._run_one(q) for q in scheduled])

    async def run_forever(self) -> None:
        await self._storage.init()
        log.info("scheduler up; tick=%ss", self._tick_seconds)
        while True:
            await self.tick()
            await asyncio.sleep(self._tick_seconds)


def build_server(config: AppConfig | None = None) -> SchedulerServer:
    config = config or get_config()
    storage: Storage = InMemoryStorage()
    pipeline = build_default_pipeline(config, storage)
    return SchedulerServer(pipeline, storage, config.server.scheduler_tick_seconds)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    asyncio.run(build_server().run_forever())


if __name__ == "__main__":
    main()
