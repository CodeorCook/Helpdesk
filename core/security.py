from datetime import datetime, timezone
import hashlib
import hmac
import os
import secrets
import time
import bcrypt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import HTTPException, Request
from jose import JWTError, jwt
from core.database import ConfigurationError, required_setting

PASSWORD_HASHER = PasswordHasher()
DUMMY_HASH = PASSWORD_HASHER.hash(secrets.token_urlsafe(32))
COOKIE_NAME = "helpdesk_session"

def session_seconds() -> int:
    try:
        minutes = int(os.getenv("SESSION_MINUTES", "60"))
        if not 1 <= minutes <= 1440:
            raise ValueError()
        return minutes * 60
    except ValueError as exc:
        raise ConfigurationError("SESSION_MINUTES phải nằm trong 1–1440.") from exc

def signing_key() -> str:
    key = required_setting("JWT_SECRET_KEY")
    if len(key.encode()) < 32:
        raise ConfigurationError("JWT_SECRET_KEY phải có ít nhất 32 byte.")
    return key

def verify_password(password: str, encoded: str) -> bool:
    try:
        if encoded.startswith("$argon2id$"):
            return PASSWORD_HASHER.verify(encoded, password)
        if encoded.startswith(("$2a$", "$2b$", "$2y$")):
            return bcrypt.checkpw(password.encode(), encoded.encode())
    except (VerificationError, InvalidHashError, ValueError, TypeError):
        pass
    return False

def burn_password_check(password: str):
    verify_password(password, DUMMY_HASH)

def account_session_version(updated_at: datetime) -> str:
    return updated_at.astimezone(timezone.utc).isoformat()


def refresh_account_session(claims: dict, updated_at: datetime) -> str:
    return jwt.encode({**claims, "account_version": account_session_version(updated_at)}, signing_key(), algorithm="HS256")


def issue_session(user_id: str, account_version: str) -> tuple[str, str]:
    now = int(time.time())
    session_id = secrets.token_urlsafe(24)
    csrf = csrf_for(session_id)
    token = jwt.encode({"sub": user_id, "iat": now, "exp": now + session_seconds(),
        "iss": "helpdesk", "aud": "helpdesk-web", "jti": session_id, "account_version": account_version,
        "csrf": hashlib.sha256(csrf.encode()).hexdigest()}, signing_key(), algorithm="HS256")
    return token, csrf


def csrf_for(session_id: str) -> str:
    return hmac.new(signing_key().encode(), ("csrf:" + session_id).encode(), hashlib.sha256).hexdigest()

def decode_session(token: str) -> dict:
    try:
        claims = jwt.decode(token, signing_key(), algorithms=["HS256"], audience="helpdesk-web", issuer="helpdesk",
            options={"require_exp": True, "require_iat": True, "require_sub": True})
        if not all(isinstance(claims.get(key), str) for key in ("csrf", "jti", "account_version")):
            raise JWTError()
        return claims
    except JWTError as exc:
        raise HTTPException(401, "Phiên không hợp lệ hoặc đã hết hạn.") from exc

def allowed_origins() -> list[str]:
    return [v.strip() for v in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173").split(",") if v.strip()]

def check_origin(request: Request):
    if request.headers.get("origin") not in allowed_origins():
        raise HTTPException(403, "Nguồn yêu cầu không được cho phép.")

def check_csrf(request: Request, claims: dict):
    check_origin(request)
    value = request.headers.get("x-csrf-token", "")
    if not value or not hmac.compare_digest(hashlib.sha256(value.encode()).hexdigest(), claims["csrf"]):
        raise HTTPException(403, "Mã bảo vệ yêu cầu không hợp lệ.")

def secure_cookie() -> bool:
    return os.getenv("COOKIE_SECURE", "false").lower() == "true"
