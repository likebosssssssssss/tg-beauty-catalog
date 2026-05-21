from fastapi import APIRouter

router = APIRouter(prefix="/api/app", tags=["app"])

# Phase 3: Публичный API для клиентского Mini App
# GET /api/app/:slug/profile
# GET /api/app/:slug/services
# GET /api/app/:slug/slots
# POST /api/app/:slug/appointments  (атомарное бронирование)
# GET/DELETE /api/app/:slug/my-appointments
