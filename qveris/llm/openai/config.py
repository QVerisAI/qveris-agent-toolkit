from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class OpenAIConfig(BaseSettings):
    """Configuration for OpenAI Provider"""
    api_key: Optional[str] = Field(default=None, validation_alias='OPENAI_API_KEY')
    base_url: Optional[str] = Field(default=None, validation_alias='OPENAI_BASE_URL')
    
    model_config = SettingsConfigDict(
        env_prefix="",
        case_sensitive=False,
        extra="ignore"
    )

