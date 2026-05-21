import secrets
import uuid

import httpx
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from app.auth import get_current_master
from app.database import get_pool
from app.encryption import encrypt_token
from app.utils import generate_slug, random_suffix

router = APIRouter(prefix="/api/onboarding", tags=["onboarding"])


class SetupBotRequest(BaseModel):
    bot_token: str


class ProfileRequest(BaseModel):
    name: str
    specialty: str | None = None
    city: str | None = None
    metro: str | None = None
    bio: str | None = None


class ScheduleDay(BaseModel):
    day_of_week: int
    start_time: str   # "10:00"
    end_time: str     # "19:00"
    slot_length: int = 30
    is_working: bool


@router.get("/status")
async def onboarding_status(master: dict = Depends(get_current_master)):
    pool = await get_pool()
    row = await pool.fetchrow(
        "SELECT onboarding_step, name, slug, bot_username, specialty, city FROM masters WHERE id = $1",
        master['master_id'],
    )
    return dict(row)


@router.post("/setup-bot")
async def setup_bot(
    data: SetupBotRequest,
    master: dict = Depends(get_current_master),
):
    """
    Шаг 2 онбординга: мастер вводит токен своего бота.
    Проверяем токен через getMe, шифруем и регистрируем вебхук.
    """
    master_id = master['master_id']

    # Проверяем токен у Telegram
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"https://api.telegram.org/bot{data.bot_token}/getMe",
            timeout=10.0,
        )

    if not resp.is_success or not resp.json().get('ok'):
        raise HTTPException(status_code=400, detail="Invalid bot token. Check and try again.")

    bot_info = resp.json()['result']
    bot_username = bot_info.get('username', '')

    pool = await get_pool()

    # Проверяем что этот бот не зарегистрирован другим мастером
    conflict = await pool.fetchval(
        "SELECT 1 FROM masters WHERE bot_username = $1 AND id != $2",
        bot_username,
        master_id,
    )
    if conflict:
        raise HTTPException(status_code=409, detail="This bot is already used by another master.")

    encrypted_token = encrypt_token(data.bot_token)
    webhook_path = str(uuid.uuid4())
    webhook_secret = secrets.token_urlsafe(32)

    await pool.execute(
        """
        UPDATE masters
        SET bot_token = $1,
            bot_username = $2,
            bot_webhook_path = $3,
            bot_webhook_secret = $4,
            onboarding_step = GREATEST(onboarding_step, 2),
            updated_at = NOW()
        WHERE id = $5
        """,
        encrypted_token,
        bot_username,
        webhook_path,
        webhook_secret,
        master_id,
    )

    return {
        "bot_username": f"@{bot_username}",
        "status": "ok",
    }


@router.post("/profile")
async def setup_profile(
    data: ProfileRequest,
    master: dict = Depends(get_current_master),
):
    """Шаг 3 онбординга: профиль мастера (имя, специализация, город)."""
    master_id = master['master_id']
    pool = await get_pool()

    # Генерируем slug на основе имени
    base_slug = generate_slug(data.name)
    slug = base_slug
    for _ in range(10):
        taken = await pool.fetchval(
            "SELECT 1 FROM masters WHERE slug = $1 AND id != $2",
            slug,
            master_id,
        )
        if not taken:
            break
        slug = f"{base_slug}-{random_suffix()}"

    await pool.execute(
        """
        UPDATE masters
        SET name = $1,
            specialty = $2,
            city = $3,
            metro = $4,
            bio = $5,
            slug = $6,
            onboarding_step = GREATEST(onboarding_step, 3),
            updated_at = NOW()
        WHERE id = $7
        """,
        data.name,
        data.specialty,
        data.city,
        data.metro,
        data.bio,
        slug,
        master_id,
    )

    return {"slug": slug, "status": "ok"}


@router.post("/schedule")
async def setup_schedule(
    schedule: list[ScheduleDay],
    master: dict = Depends(get_current_master),
):
    """Шаг 4 онбординга: рабочее расписание (все 7 дней)."""
    if len(schedule) != 7:
        raise HTTPException(status_code=400, detail="Must provide exactly 7 days (0=Mon … 6=Sun)")

    master_id = master['master_id']
    pool = await get_pool()

    async with pool.acquire() as conn:
        async with conn.transaction():
            for day in schedule:
                await conn.execute(
                    """
                    INSERT INTO schedule
                        (master_id, day_of_week, start_time, end_time, slot_length, is_working)
                    VALUES ($1, $2, $3::time, $4::time, $5, $6)
                    ON CONFLICT (master_id, day_of_week) DO UPDATE
                    SET start_time = EXCLUDED.start_time,
                        end_time   = EXCLUDED.end_time,
                        slot_length = EXCLUDED.slot_length,
                        is_working  = EXCLUDED.is_working
                    """,
                    master_id,
                    day.day_of_week,
                    day.start_time,
                    day.end_time,
                    day.slot_length,
                    day.is_working,
                )

            await conn.execute(
                """
                UPDATE masters
                SET onboarding_step = GREATEST(onboarding_step, 4), updated_at = NOW()
                WHERE id = $1
                """,
                master_id,
            )

    return {"status": "ok"}


@router.post("/complete")
async def complete_onboarding(master: dict = Depends(get_current_master)):
    """Шаг 5: завершение онбординга."""
    master_id = master['master_id']
    pool = await get_pool()

    row = await pool.fetchrow(
        "SELECT onboarding_step, name FROM masters WHERE id = $1",
        master_id,
    )

    if row['onboarding_step'] < 3:
        raise HTTPException(
            status_code=400,
            detail="Complete profile setup (step 3) before finishing onboarding",
        )

    await pool.execute(
        """
        UPDATE masters
        SET onboarding_step = 5, is_active = TRUE, updated_at = NOW()
        WHERE id = $1
        """,
        master_id,
    )

    return {"status": "ok", "message": f"Добро пожаловать, {row['name']}! Онбординг завершён."}
