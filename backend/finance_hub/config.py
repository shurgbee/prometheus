from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    demo_mode: bool = False
    enable_dev_injection: bool = False
    api_token: str = Field(min_length=16)
    database_url: str = "sqlite+aiosqlite:///./finance.db"
    checkpoint_sqlite_path: str = "./checkpoints.db"
    cors_origins: list[str] = ["http://localhost:3000"]
    nvidia_api_key: str = ""
    super_base_url: str = "https://integrate.api.nvidia.com/v1"
    super_model: str = "nvidia/nemotron-3.5-super-vl-120b-a12b"
    super_api_key: str = ""
    nano_base_url: str = "https://integrate.api.nvidia.com/v1"
    nano_model: str = "nvidia/nemotron-3.5-lightning-30b-a3b"
    nano_api_key: str = ""
    embed_base_url: str = "https://integrate.api.nvidia.com/v1"
    embed_model: str = "nvidia/llama-nemotron-embed-vl-1b-v2"
    embed_api_key: str = ""
    embed_dimensions: int = Field(default=2048, ge=8, le=4096)
    finnhub_api_key: str = ""
    notifier_url: str = ""
    notifier_token: str = ""
    alert_phone: str = ""
    dashboard_url: str = "http://localhost:3000"
    worker_interval_seconds: float = Field(default=5, ge=0.1)
    research_lease_seconds: int = 600

    @model_validator(mode="after")
    def live_requirements(self):
        if not self.demo_mode:
            required = {
                "NVIDIA_API_KEY (or separate SUPER/NANO/EMBED_API_KEY values)":
                    self.nvidia_api_key or (self.super_api_key and self.nano_api_key and self.embed_api_key),
                "FINNHUB_API_KEY": self.finnhub_api_key,
                "NOTIFIER_URL": self.notifier_url,
                "NOTIFIER_TOKEN": self.notifier_token,
                "ALERT_PHONE": self.alert_phone,
            }
            missing = [name for name, value in required.items() if not value]
            if not self.database_url.startswith(("postgres://", "postgresql://", "postgresql+asyncpg://")):
                missing.append("DATABASE_URL (Tiger/Postgres)")
            if missing:
                raise ValueError("Live mode requires: " + ", ".join(missing))
        return self
