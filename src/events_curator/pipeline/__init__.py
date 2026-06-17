"""Pipeline module door: the orchestrator, its stage bundle, and default wiring."""

from __future__ import annotations

from events_curator.pipeline.builder import (
    IN_MEMORY_DB_PATH,
    build_authenticator,
    build_default_pipeline,
    build_default_stages,
    build_embedder,
    build_llm,
    build_search_backend,
    build_search_engine,
    build_storage,
)
from events_curator.pipeline.orchestrator import (
    CurationPipeline,
    Stages,
    UnknownSavedQueryError,
)

__all__ = [
    "IN_MEMORY_DB_PATH",
    "CurationPipeline",
    "Stages",
    "UnknownSavedQueryError",
    "build_authenticator",
    "build_default_pipeline",
    "build_default_stages",
    "build_embedder",
    "build_llm",
    "build_search_backend",
    "build_search_engine",
    "build_storage",
]
