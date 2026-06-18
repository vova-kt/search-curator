"""Application configuration. Every value is loaded from ``config.toml`` — there
are **no in-code defaults**.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from pydantic import BaseModel, Field, model_validator
from pydantic_settings import (
    BaseSettings,
    PydanticBaseSettingsSource,
    SettingsConfigDict,
    TomlConfigSettingsSource,
)

from events_curator.enums import (
    AuthScheme,
    EmbedderKind,
    LLMProvider,
    LLMRole,
    LogLevel,
    NoisyLogger,
    ReasoningEffort,
    SearchContextSize,
    SearchEngineKind,
)

CONFIG_TOML = "config.toml"


class LLMRoleSettings(BaseModel):
    """One LLM call site's settings."""

    model: str
    temperature: float = Field(ge=0.0, le=2.0)
    prompt: str


class LLMSettings(BaseModel):
    provider: LLMProvider
    api_key: str
    model: str  # the model the native web-search backend runs (its own call site)
    roles: dict[LLMRole, LLMRoleSettings]

    @model_validator(mode="after")
    def _require_every_role(self) -> LLMSettings:
        missing = sorted(r.value for r in LLMRole if r not in self.roles)
        if missing:
            raise ValueError(f"[llm.roles] must define every role; missing: {', '.join(missing)}")
        return self

    def for_role(self, role: LLMRole) -> LLMRoleSettings:
        """The settings for one call site. Presence is guaranteed by the validator."""
        return self.roles[role]


class EmbeddingSettings(BaseModel):
    kind: EmbedderKind
    model: str
    dimensions: int


class UserLocationSettings(BaseModel):
    """Optional geographic bias for the native web-search tool. Any field left blank
    is omitted; all-blank means no location preference (e.g. a non-geographic
    target like papers)."""

    city: str
    country: str  # ISO 3166 alpha-2
    region: str
    timezone: str  # IANA name, e.g. "Europe/Berlin"


class SearchSettings(BaseModel):
    engine: SearchEngineKind
    max_results_per_query: int
    rrf_k: int  # Reciprocal Rank Fusion constant
    search_context_size: SearchContextSize  # web_search cost/recall dial
    reasoning_effort: ReasoningEffort  # the web-search model's thinking budget
    allowed_domains: list[str]  # restrict web_search to these domains; empty = no restriction
    user_location: UserLocationSettings
    instructions: str  # system prompt steering the native web-search backend


class DedupSettings(BaseModel):
    """Two thresholds split the cosine range into auto-merge / tiebreak / new."""

    auto_merge_threshold: float = Field(ge=0.0, le=1.0)
    tiebreak_low_threshold: float = Field(ge=0.0, le=1.0)
    block_window_days: int  # date-window half-width for the blocking key


class RankSettings(BaseModel):
    top_n: int
    exploration_slots: int  # reserve slots for diverse/uncertain items
    logistic_blender_min_labels: int  # below this, skip the learned blender


class StorageSettings(BaseModel):
    db_path: str


class AuthSettings(BaseModel):
    scheme: AuthScheme
    api_token: str


class ServerSettings(BaseModel):
    host: str
    port: int
    scheduler_tick_seconds: int


class LoggingSettings(BaseModel):
    """The baseline log level applied at app startup by `setup_logging`. Individual
    loggers (e.g. a single pipeline stage, `events_curator.stage.<name>`) can be
    dialed independently at runtime via `logging.getLogger(...).setLevel(...)`."""

    level: LogLevel
    format: str


class AppConfig(BaseSettings):
    model_config = SettingsConfigDict(
        toml_file=CONFIG_TOML,
        env_nested_delimiter="__",
        extra="ignore",
    )

    llm: LLMSettings
    embedding: EmbeddingSettings
    search: SearchSettings
    dedup: DedupSettings
    rank: RankSettings
    storage: StorageSettings
    auth: AuthSettings
    server: ServerSettings
    logging: LoggingSettings

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        # `config.toml` is the file-based source; env vars
        # take precedence so Docker/CI can override a value or inject a secret.
        del dotenv_settings, file_secret_settings
        return (init_settings, env_settings, TomlConfigSettingsSource(settings_cls))


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    """Process-wide config singleton, and the one place `AppConfig` is constructed.

    Every field is populated from `config.toml`/env by the settings sources at
    runtime, so the no-argument call is correct; pyright can't see those sources and
    reads the (default-less) fields as required constructor args, hence the ignore.
    """
    return AppConfig()  # pyright: ignore[reportCallIssue]


def setup_logging(
    config: AppConfig | None = None, *, level_override: LogLevel | None = None
) -> None:
    """Initialize root logging for an app.

    Noisy third-party loggers are pinned to WARNING.
    """
    config = config or get_config()
    level = level_override or config.logging.level
    logging.basicConfig(level=level.value, format=config.logging.format, force=True)
    for noisy in NoisyLogger:
        logging.getLogger(noisy.value).setLevel(LogLevel.WARNING.value)
