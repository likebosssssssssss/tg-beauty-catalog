from fastapi import APIRouter, HTTPException, Header

from app.auth import verify_init_data, create_jwt
from app.database import get_pool
from app.config import settings

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/master-token")
async def get_master_token(
    x_telegram_init_data: str = Header(alias="X-Telegram-Init-Data", default=None),
):
    """
    Выдаёт JWT мастеру после верификации initData от Telegram Mini App.
    Используется при каждом открытии мастером своего приложения.
    """
    if not x_telegram_init_data:
        raise HTTPException(status_code=401, detail="Missing X-Telegram-Init-Data header")

    try:
        data = verify_init_data(x_telegram_init_data, settings.platform_bot_token)
    except ValueError as e:
        raise HTTPException(status_code=401, detail=str(e))

    user = data.get('user', {})
    telegram_user_id = user.get('id')
    if not telegram_user_id:
        raise HTTPException(status_code=401, detail="No user in initData")

    pool = await get_pool()
    master = await pool.fetchrow(
        """
        SELECT id, telegram_user_id, onboarding_step, plan
        FROM masters
        WHERE telegram_user_id = $1 AND is_active = TRUE
        """,
        telegram_user_id,
    )

    if not master:
        raise HTTPException(status_code=403, detail="Master account not found. Register first.")

    token = create_jwt(str(master['id']), master['telegram_user_id'])

    return {
        "token": token,
        "master_id": str(master['id']),
        "onboarding_step": master['onboarding_step'],
        "plan": master['plan'],
    }
