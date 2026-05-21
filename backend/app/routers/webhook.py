import httpx
from fastapi import APIRouter, Header, Body, Response

from app.database import get_pool
from app.encryption import decrypt_token

router = APIRouter(tags=["webhook"])


@router.post("/webhook/{webhook_path}")
async def telegram_webhook(
    webhook_path: str,
    update: dict = Body(...),
    secret_header: str | None = Header(
        alias="X-Telegram-Bot-Api-Secret-Token", default=None
    ),
):
    """
    Принимает обновления от Telegram для ботов мастеров.
    Роутинг по случайному UUID (bot_webhook_path), не по токену.
    """
    pool = await get_pool()

    master = await pool.fetchrow(
        """
        SELECT id, bot_webhook_secret, bot_token, name
        FROM masters
        WHERE bot_webhook_path = $1 AND is_active = TRUE
        """,
        webhook_path,
    )

    if not master:
        # Возвращаем 200 чтобы не давать информацию об отсутствии пути
        return Response(status_code=200)

    if not secret_header or secret_header != master['bot_webhook_secret']:
        return Response(status_code=200)

    bot_token = decrypt_token(master['bot_token'])
    await _dispatch(update, str(master['id']), bot_token)

    return Response(status_code=200)


async def _dispatch(update: dict, master_id: str, bot_token: str):
    message = update.get('message', {})
    text = message.get('text', '')
    chat_id = message.get('chat', {}).get('id')

    if not chat_id:
        return

    if text.startswith('/start'):
        await _send(bot_token, chat_id, "Привет! Нажмите кнопку, чтобы записаться к мастеру.")
    elif text.startswith('/help'):
        await _send(bot_token, chat_id, "Используйте /start для начала.")


async def _send(bot_token: str, chat_id: int, text: str):
    async with httpx.AsyncClient() as client:
        await client.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": text},
            timeout=10.0,
        )
