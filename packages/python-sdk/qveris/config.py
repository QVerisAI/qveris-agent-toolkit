"""
Configuration models for the Qveris Python SDK.

This module defines two `pydantic-settings` models:

- `QverisConfig`: Qveris API connectivity + agent runtime limits.
- `AgentConfig`: LLM behavior configuration (model, temperature, system prompt additions).

Both classes inherit from `pydantic_settings.BaseSettings`, so values can be supplied either:

- explicitly via constructor, e.g. `QverisConfig(api_key="...")`, or
- implicitly via environment variables (see field aliases below).

## Environment variables

`QverisConfig`
- `QVERIS_API_KEY`: Qveris API key (sent as `Authorization: Bearer ...`)
- `QVERIS_BASE_URL`: API base URL (defaults to `https://qveris.ai/api/v1/`)

`AgentConfig`
- no fixed env var aliases are defined here (pass values explicitly), but you can still rely on
  `BaseSettings` behavior if you add your own `validation_alias` fields in a fork.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Tuple, Type

from pydantic import Field
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict


class _AliasedInitSource(PydanticBaseSettingsSource):
    """Init source that re-keys constructor kwargs onto each field's env alias.

    ``QverisConfig(api_key=...)`` is emitted under the same key the env source
    uses (``QVERIS_API_KEY``); placed ahead of the env source it therefore wins,
    so an explicit constructor value overrides the environment (issue #136).
    This is done *instead of* adding the field name as a ``validation_alias``
    choice, which under ``case_sensitive=False`` would make pydantic-settings
    also read the generic ``API_KEY`` / ``BASE_URL`` env vars — extremely common
    names that would silently hijack the config.
    """

    def __init__(self, settings_cls: Type[BaseSettings], init_kwargs: Dict[str, Any]) -> None:
        super().__init__(settings_cls)
        self._init_kwargs = init_kwargs

    def get_field_value(self, field: Any, field_name: str) -> Tuple[Any, str, bool]:  # pragma: no cover
        return None, field_name, False

    def __call__(self) -> Dict[str, Any]:
        mapped: Dict[str, Any] = {}
        for name, value in self._init_kwargs.items():
            field = self.settings_cls.model_fields.get(name)
            alias = getattr(field, "validation_alias", None) if field is not None else None
            mapped[alias if isinstance(alias, str) else name] = value
        return mapped


class QverisConfig(BaseSettings):
    """
    Configuration for Qveris connectivity and agent loop limits.

    This config is used by:

    - `qveris.client.api.QverisClient` (API key, base URL)
    - `qveris.agent.core.Agent` (loop controls like history pruning and max iterations)
    """

    # Qveris Settings. The env source reads ONLY the ``QVERIS_``-prefixed names;
    # an explicit ``QverisConfig(api_key=...)`` still wins over the env var via
    # the custom init source below (see settings_customise_sources / #136).
    api_key: Optional[str] = Field(default=None, validation_alias="QVERIS_API_KEY")
    base_url: str = Field(default="https://qveris.ai/api/v1/", validation_alias="QVERIS_BASE_URL")

    # Transport settings. On a 429 (or 503) the client honors Retry-After and
    # otherwise backs off exponentially with jitter, up to this many retries.
    max_retries: int = Field(
        default=3,
        validation_alias="QVERIS_MAX_RETRIES",
        description="Max automatic retries for rate-limited (429) / transient (503) responses.",
    )

    # Agent behavior settings
    enable_history_pruning: bool = Field(
        default=True,
        description="Whether to prune/compress old tool outputs to save tokens",
    )
    max_iterations: int = Field(
        default=50,
        description="Maximum number of iterations for the agent tool loop",
    )

    model_config = SettingsConfigDict(
        env_prefix="",  # We use specific aliases
        case_sensitive=False,
        # populate_by_name is intentionally NOT set: it would make the env source
        # also read the bare field names (api_key -> generic API_KEY env var,
        # base_url -> BASE_URL), which under case_sensitive=False silently hijacks
        # the config from common environment names. Constructor-by-name still
        # works via the aliased init source below (#136).
        extra="ignore",
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: Type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> Tuple[PydanticBaseSettingsSource, ...]:
        # Re-key init kwargs onto field aliases so an explicit constructor value
        # overrides the environment, robustly across pydantic versions (#136),
        # without exposing field names as env-readable aliases.
        init_kwargs = getattr(init_settings, "init_kwargs", {})
        aliased_init = _AliasedInitSource(settings_cls, init_kwargs)
        return (aliased_init, env_settings, dotenv_settings, file_secret_settings)


class AgentConfig(BaseSettings):
    """
    Configuration for LLM behavior used by `Agent`.

    Notes:
        - `model` is passed to the active `LLMProvider` implementation.
        - `additional_system_prompt` is appended to the default system prompt used for tool use.
        - `temperature` is forwarded to the provider (if supported).
    """

    model: str = "gpt-4o"

    additional_system_prompt: Optional[str] = None

    temperature: float = 0.7
