"""Pipeline module door: the orchestrator, its stage bundle, and default wiring."""

from __future__ import annotations

from events_curator.pipeline.builder import build_default_pipeline, build_default_stages
from events_curator.pipeline.orchestrator import (
    CurationPipeline,
    Stages,
    UnknownSavedQueryError,
)

__all__ = [
    "CurationPipeline",
    "Stages",
    "UnknownSavedQueryError",
    "build_default_pipeline",
    "build_default_stages",
]
