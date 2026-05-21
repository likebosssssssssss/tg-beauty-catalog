from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel

from app.config import settings
from app.database import get_pool
from app.auth import create_jwt
from app.utils import generate_slug, random_suffix

router = APIRouter(prefix="/internal", tags=["internal"])


class RegisterRequest(BaseModel):
    telegram_user_id: int
    first_name: str
    username: str | None = None


@router.post("/onboarding/register")
async def internal_register(
    data: RegisterRequest,
    secret: str = Header(alias="X-Internal-Secret", default=None),
):
    if not secret or secret != settings.internal_api_secret:
        raise HTTPException(status_code=403, detail="Forbidden")

    pool = await get_pool()

    # Идемпотентно: мастер уже существует → возвращаем его JWT
    existing = await pool.fetchrow(
        "SELECT id, telegram_user_id FROM masters WHERE telegram_user_id = $1",
        data.telegram_user_id,
    )
    if existing:
        token = create_jwt(str(existing['id']), existing['telegram_user_id'])
        return {"master_id": str(existing['id']), "jwt": token, "is_new": False}

    # Генерируем уникальный slug
    base_slug = generate_slug(data.first_name)
    slug = base_slug
    for _ in range(10):
        taken = await pool.fetchval("SELECT 1 FROM masters WHERE slug = $1", slug)
        if not taken:
            break
        slug = f"{base_slug}-{random_suffix()}"

    master = await pool.fetchrow(
        """
        INSERT INTO masters (telegram_user_id, slug, name, onboarding_step)
        VALUES ($1, $2, $3, 0)
        RETURNING id, telegram_user_id
        """,
        data.telegram_user_id,
        slug,
        data.first_name,
    )

    # Дефолтное расписание: пн–пт 10:00–19:00, сб–вс выходные
    for day in range(7):
        await pool.execute(
            """
            INSERT INTO schedule (master_id, day_of_week, start_time, end_time, slot_length, is_working)
            VALUES ($1, $2, '10:00', '19:00', 30, $3)
            """,
            master['id'],
            day,
            day < 5,
        )

    token = create_jwt(str(master['id']), master['telegram_user_id'])
    return {"master_id": str(master['id']), "jwt": token, "is_new": True}
