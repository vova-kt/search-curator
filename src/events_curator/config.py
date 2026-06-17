"""Application configuration, loaded from the environment / `.env`.

Nested groups use the ``__`` delimiter, e.g. ``DEDUP__AUTO_MERGE_THRESHOLD=0.9``.
Tunable thresholds live here (not as literals at call sites) so they can be
swept in eval without touching code.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from events_curator.enums import (
    AuthScheme,
    EmbedderKind,
    LLMProvider,
    LogLevel,
    NoisyLogger,
    SearchEngineKind,
)


class LLMSettings(BaseModel):
    provider: LLMProvider = LLMProvider.OPENAI
    model: str = "gpt-4o-mini"
    api_key: str = ""


class EmbeddingSettings(BaseModel):
    kind: EmbedderKind = EmbedderKind.BGE_SMALL
    model: str = "BAAI/bge-small-en-v1.5"
    dimensions: int = 384


class SearchSettings(BaseModel):
    engine: SearchEngineKind = SearchEngineKind.FRONTIER_NATIVE
    max_results_per_query: int = 20
    rrf_k: int = 60  # Reciprocal Rank Fusion constant


class DedupSettings(BaseModel):
    """Two thresholds split the cosine range into auto-merge / tiebreak / new."""

    auto_merge_threshold: float = Field(default=0.88, ge=0.0, le=1.0)
    tiebreak_low_threshold: float = Field(default=0.75, ge=0.0, le=1.0)
    block_window_days: int = 1  # date-window half-width for the blocking key


class RankSettings(BaseModel):
    top_n: int = 25
    exploration_slots: int = 2  # reserve slots for diverse/uncertain items
    logistic_blender_min_labels: int = 50  # below this, skip the learned blender


class StorageSettings(BaseModel):
    db_path: str = "./events.db"


class AuthSettings(BaseModel):
    scheme: AuthScheme = AuthScheme.LOCAL
    api_token: str = ""


class ServerSettings(BaseModel):
    host: str = "0.0.0.0"  # bound inside the Docker network
    port: int = 8080
    scheduler_tick_seconds: int = 300


class LoggingSettings(BaseModel):
    """The baseline log level applied at app startup by `setup_logging`. Individual
    loggers (e.g. a single pipeline stage, `events_curator.stage.<name>`) can be
    dialed independently at runtime via `logging.getLogger(...).setLevel(...)`."""

    level: LogLevel = LogLevel.INFO
    format: str = "%(asctime)s %(levelname)-8s %(name)s: %(message)s"


class AppConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_nested_delimiter="__",
        extra="ignore",
    )

    llm: LLMSettings = Field(default_factory=LLMSettings)
    embedding: EmbeddingSettings = Field(default_factory=EmbeddingSettings)
    search: SearchSettings = Field(default_factory=SearchSettings)
    dedup: DedupSettings = Field(default_factory=DedupSettings)
    rank: RankSettings = Field(default_factory=RankSettings)
    storage: StorageSettings = Field(default_factory=StorageSettings)
    auth: AuthSettings = Field(default_factory=AuthSettings)
    server: ServerSettings = Field(default_factory=ServerSettings)
    logging: LoggingSettings = Field(default_factory=LoggingSettings)


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    """Process-wide config singleton."""
    return AppConfig()


def setup_logging(
    config: AppConfig | None = None, *, level_override: LogLevel | None = None
) -> None:
    """Initialize root logging for an app entrypoint — call once at startup.

    `level_override` beats the configured level (the Streamlit console forces
    DEBUG regardless of `.env`). `force=True` re-applies the handler so repeated
    calls — e.g. Streamlit re-running the script on each interaction — don't stack
    duplicate handlers. Noisy third-party loggers are pinned to WARNING so their
    chatter doesn't follow the root level down to DEBUG.
    """
    config = config or get_config()
    level = level_override or config.logging.level
    logging.basicConfig(level=level.value, format=config.logging.format, force=True)
    for noisy in NoisyLogger:
        logging.getLogger(noisy.value).setLevel(LogLevel.WARNING.value)
