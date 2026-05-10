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

from typing import Optional

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

class QverisConfig(BaseSettings):
    """
    Configuration for Qveris connectivity and agent loop limits.

    This config is used by:

    - `qveris.client.api.QverisClient` (API key, base URL)
    - `qveris.agent.core.Agent` (loop controls like history pruning and max iterations)
    """
    # Qveris Settings
    api_key: Optional[str] = Field(default=None, validation_alias='QVERIS_API_KEY')
    base_url: str = Field(default="https://qveris.ai/api/v1/", validation_alias='QVERIS_BASE_URL')

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
        extra="ignore"
    )

class AgentConfig(BaseSettings):
    """
    Configuration for LLM behavior used by `Agent`.

    Notes:
        - `model` is passed to the active `LLMProvider` implementation.
        - `additional_system_prompt` is appended to the default system prompt used for tool use.
        - `temperature` is forwarded to the provider (if supported).
    """

    model: str = "gpt-5"

    additional_system_prompt: Optional[str] = None

    temperature: float = 0.7
