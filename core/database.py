from pathlib import Path
import os
import psycopg
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

class ConfigurationError(RuntimeError):
    pass

def required_setting(name: str) -> str:
    value = os.getenv(name, "")
    if not value.strip():
        raise ConfigurationError(f"Thiếu cấu hình {name}. Vui lòng kiểm tra .env.")
    return value

def database_schema() -> str:
    return required_setting("DB_SCHEMA")

def get_connection():
    try:
        port = int(os.getenv("DB_PORT", "5432"))
        if not 1 <= port <= 65535:
            raise ValueError()
    except ValueError as exc:
        raise ConfigurationError("DB_PORT phải là số nguyên từ 1 đến 65535.") from exc
    return psycopg.connect(host=os.getenv("DB_HOST", "localhost"),
        port=port, dbname=required_setting("DB_NAME"),
        user=required_setting("DB_USER"), password=required_setting("DB_PASSWORD"), connect_timeout=5)
