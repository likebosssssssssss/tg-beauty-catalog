import hashlib
import hmac
import time
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, unquote

import jwt
from fastapi import HTTPException, Header

from app.config import settings


def verify_init_data(init_data_raw: str, bot_token: str) -> dict:
    """
    Проверяет подпись initData от Telegram Mini App.
    Возвращает распарсенный словарь с данными пользователя.
    Бросает ValueError если подпись невалидна или устарела.
    """
    parsed = dict(parse_qsl(init_data_raw, keep_blank_values=True))
    received_hash = parsed.pop('hash', None)
    if not received_hash:
        raise ValueError("No hash in initData")

    data_check_string = "\n".join(
        f"{k}={v}" for k, v in sorted(parsed.items())
    )
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), digestmod=hashlib.sha256).digest()
    expected_hash = hmac.new(secret_key, data_check_string.encode(), digestmod=hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        raise ValueError("Invalid initData signature")

    if 'auth_date' in parsed:
        if abs(time.time() - int(parsed['auth_date'])) > 3600:
            raise ValueError("initData expired (older than 1 hour)")

    if 'user' in parsed:
        parsed['user'] = json.loads(unquote(parsed['user']))

    return parsed


def create_jwt(master_id: str, telegram_user_id: int, role: str = 'master') -> str:
    expire = datetime.now(timezone.utc) + timedelta(hours=settings.jwt_expire_hours)
    payload = {
        'master_id': master_id,
        'telegram_user_id': telegram_user_id,
        'role': role,
        'exp': expire,
        'iat': datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_jwt(token: str) -> dict:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


async def get_current_master(
    authorization: str = Header(alias="Authorization", default=None)
) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization.removeprefix("Bearer ")
    try:
        payload = decode_jwt(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    if payload.get('role') != 'master':
        raise HTTPException(status_code=403, detail="Master role required")

    return payload
