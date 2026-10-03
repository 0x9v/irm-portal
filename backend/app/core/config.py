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
