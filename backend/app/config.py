from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file='.env',
        env_file_encoding='utf-8',
        extra='ignore'
    )

    # Database
    database_url: str

    # Telegram
    platform_bot_token: str
    internal_api_secret: str

    # Encryption for master bot tokens
    bot_encryption_key: str

    # JWT
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expire_hours: int = 24

    # Cloudflare R2 (Phase 2)
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = "beauty-photos"
    r2_public_url: str = ""

    # App URLs
    app_base_url: str = ""
    api_base_url: str = ""


settings = Settings()
