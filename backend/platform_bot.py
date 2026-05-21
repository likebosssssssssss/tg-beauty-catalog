"""
platform_bot.py — Бот платформы (@yoursaas_bot).

Мастер пишет /start → бот регистрирует его через /internal/onboarding/register
→ отправляет ссылку на онбординг Mini App с JWT-токеном.

Запуск: python platform_bot.py
"""
import asyncio
import logging
import os
import sys

import httpx

# Загрузка .env
_env = os.path.join(os.path.dirname(__file__), '.env')
if os.path.exists(_env):
    with open(_env) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _k, _v = _line.split('=', 1)
                os.environ.setdefault(_k.strip(), _v.strip())

PLATFORM_BOT_TOKEN = os.environ.get('PLATFORM_BOT_TOKEN', '')
INTERNAL_API_SECRET = os.environ.get('INTERNAL_API_SECRET', '')
API_BASE_URL = os.environ.get('API_BASE_URL', 'http://127.0.0.1:8000')
APP_BASE_URL = os.environ.get('APP_BASE_URL', '')

if not PLATFORM_BOT_TOKEN:
    print("ERROR: PLATFORM_BOT_TOKEN not set in .env")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
)
logger = logging.getLogger(__name__)


async def tg(method: str, payload: dict = None, timeout: float = 15.0) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{PLATFORM_BOT_TOKEN}/{method}",
            json=payload or {},
            timeout=timeout,
        )
        return resp.json()


async def register_master(telegram_user_id: int, first_name: str, username: str | None) -> dict:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{API_BASE_URL}/internal/onboarding/register",
            json={
                "telegram_user_id": telegram_user_id,
                "first_name": first_name,
                "username": username,
            },
            headers={"X-Internal-Secret": INTERNAL_API_SECRET},
            timeout=10.0,
        )
        resp.raise_for_status()
        return resp.json()


async def handle_start(message: dict):
    chat_id = message['chat']['id']
    user = message.get('from', {})
    first_name = user.get('first_name', 'Мастер')
    username = user.get('username')
    telegram_user_id = user.get('id')

    try:
        result = await register_master(telegram_user_id, first_name, username)
        jwt_token = result['jwt']
        is_new = result.get('is_new', True)

        onboarding_url = f"{APP_BASE_URL}/setup?token={jwt_token}" if APP_BASE_URL else ""

        if is_new:
            text = (
                f"Привет, {first_name}! 👋\n\n"
                "Добро пожаловать на платформу для бьюти-мастеров!\n\n"
                "Нажмите кнопку ниже, чтобы настроить ваш профиль и начать принимать клиентов:"
            )
        else:
            text = (
                f"С возвращением, {first_name}! 👋\n\n"
                "Нажмите кнопку ниже, чтобы открыть ваш профиль:"
            )

        payload = {"chat_id": chat_id, "text": text}
        if onboarding_url:
            payload["reply_markup"] = {
                "keyboard": [[
                    {"text": "🚀 Открыть профиль", "web_app": {"url": onboarding_url}}
                ]],
                "resize_keyboard": True,
                "one_time_keyboard": False,
            }

        await tg("sendMessage", payload)

    except Exception as e:
        logger.error(f"Error handling /start for user {telegram_user_id}: {e}")
        await tg("sendMessage", {
            "chat_id": chat_id,
            "text": "Произошла ошибка. Попробуйте позже.",
        })


async def poll():
    offset = 0
    logger.info("Platform bot started (long polling)")

    while True:
        try:
            result = await tg("getUpdates", {
                "offset": offset,
                "timeout": 25,
                "allowed_updates": ["message"],
            }, timeout=35.0)

            for update in result.get("result", []):
                offset = update["update_id"] + 1
                message = update.get("message", {})
                text = message.get("text", "")

                if text.startswith("/start"):
                    await handle_start(message)
                elif text.startswith("/help"):
                    await tg("sendMessage", {
                        "chat_id": message['chat']['id'],
                        "text": "Используйте /start для регистрации на платформе.",
                    })

        except Exception as e:
            logger.error(f"Polling error: {e}")
            await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(poll())
