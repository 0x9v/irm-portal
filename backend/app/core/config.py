from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL

ROOT_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=ROOT_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_name: str = Field(validation_alias="POSTGRES_DB")
    database_user: str = Field(validation_alias="POSTGRES_USER")
    database_password: SecretStr = Field(validation_alias="POSTGRES_PASSWORD")
    database_host: str = "127.0.0.1"
    database_port: int = 5433

    session_cookie_name: str = "session"
    secure_cookies: bool = False
    session_lifetime_days: int = 7
    storage_root: Path = Field(default=ROOT_DIR / "storage")
    frontend_url: str = "http://localhost:3000"
    document_upload_max_bytes: int = Field(default=52428800, gt=0)
    environment: str = Field(default="development", validation_alias="ENVIRONMENT")
    extra_websocket_origins: list[str] = Field(default_factory=list, validation_alias="EXTRA_WEBSOCKET_ORIGINS")
    membership_current_academic_year_start: int = Field(
        default=2026,
        ge=1000,
        le=9998,
        validation_alias="MEMBERSHIP_CURRENT_ACADEMIC_YEAR_START",
    )

    def get_trusted_websocket_origins(self) -> set[str]:
        """
        Derives the exact set of trusted origins permitted to establish WebSocket connections.
        In production, only the explicitly configured frontend_url (and any extra origins) are permitted.
        Localhost origins are strictly prohibited in production and require development/test environment.
        """
        origins = {self.frontend_url.rstrip("/")}
        if self.environment.lower() in ("development", "dev", "test"):
            origins.add("http://localhost:3000")
            origins.add("http://127.0.0.1:3000")
        for o in self.extra_websocket_origins:
            origins.add(o.rstrip("/"))
        return origins

    @property
    def database_url(self) -> URL:
        return URL.create(
            "postgresql+psycopg",
            username=self.database_user,
            password=self.database_password.get_secret_value(),
            host=self.database_host,
            port=self.database_port,
            database=self.database_name,
        )


settings = Settings()
