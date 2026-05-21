"""
worker.py — Фоновый воркер уведомлений.

Читает notifications_queue каждую минуту и отправляет сообщения
через боты мастеров. Использует SELECT FOR UPDATE SKIP LOCKED
для безопасной параллельной работы нескольких воркеров (хотя обычно один).

Запуск: python worker.py
"""
import asyncio
import logging
import os
import sys

import asyncpg
import httpx

# Загрузка .env (чтобы воркер можно было запускать отдельно от FastAPI)
_env = os.path.join(os.path.dirname(__file__), '.env')
if os.path.exists(_env):
    with open(_env) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _k, _v = _line.split('=', 1)
                os.environ.setdefault(_k.strip(), _v.strip())

DATABASE_URL = os.environ.get('DATABASE_URL', '')
BOT_ENCRYPTION_KEY = os.environ.get('BOT_ENCRYPTION_KEY', '')

if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set in .env")
    sys.exit(1)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s %(message)s',
)
logger = logging.getLogger(__name__)

POLL_INTERVAL = 60   # секунд между итерациями
MAX_RETRIES = 3


def _decrypt_token(encrypted: str) -> str:
    from cryptography.fernet import Fernet
    return Fernet(BOT_ENCRYPTION_KEY.encode()).decrypt(encrypted.encode()).decode()


_NOTIFICATION_TEXTS = {
    'confirmation': '✅ Запись подтверждена! Ждём вас.',
    'reminder_24h': '⏰ Напоминание: завтра у вас запись к мастеру.',
    'reminder_2h':  '⏰ Напоминание: через 2 часа у вас запись.',
    'cancellation': '❌ Ваша запись отменена.',
}


async def _send_tg_message(bot_token: str, chat_id: int, text: str) -> bool:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{bot_token}/sendMessage",
            json={"chat_id": chat_id, "text": text},
            timeout=10.0,
        )
    return resp.is_success and resp.json().get('ok', False)


async def process_batch(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        async with conn.transaction():
            rows = await conn.fetch(
                """
                SELECT n.id, n.type, n.chat_id, n.retry_count,
                       m.bot_token
                FROM notifications_queue n
                JOIN masters m ON m.id = n.master_id
                WHERE n.status = 'pending'
                  AND n.scheduled_at <= NOW()
                  AND m.bot_token IS NOT NULL
                ORDER BY n.scheduled_at
                LIMIT 50
                FOR UPDATE OF n SKIP LOCKED
                """
            )

            if not rows:
                return

            logger.info(f"Processing {len(rows)} notifications")

            for row in rows:
                text = _NOTIFICATION_TEXTS.get(row['type'], 'Уведомление от мастера')
                try:
                    bot_token = _decrypt_token(row['bot_token'])
                    ok = await _send_tg_message(bot_token, row['chat_id'], text)
                except Exception as e:
                    logger.error(f"Error sending notification {row['id']}: {e}")
                    ok = False

                if ok:
                    await conn.execute(
                        "UPDATE notifications_queue SET status='sent', sent_at=NOW() WHERE id=$1",
                        row['id'],
                    )
                else:
                    retry = row['retry_count'] + 1
                    new_status = 'failed' if retry >= MAX_RETRIES else 'pending'
                    await conn.execute(
                        """
                        UPDATE notifications_queue
                        SET retry_count = $1, status = $2
                        WHERE id = $3
                        """,
                        retry,
                        new_status,
                        row['id'],
                    )


async def run():
    pool = await asyncpg.create_pool(
        dsn=DATABASE_URL,
        min_size=1,
        max_size=3,
        ssl='require',
    )
    logger.info("Worker started. Polling every %ds", POLL_INTERVAL)

    while True:
        try:
            await process_batch(pool)
        except Exception as e:
            logger.error(f"Worker error: {e}")
        await asyncio.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    asyncio.run(run())
