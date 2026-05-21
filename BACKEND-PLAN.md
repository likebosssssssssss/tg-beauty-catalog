# BACKEND-PLAN.md — SaaS-платформа для бьюти-мастеров

> Версия: 2.0 (исправлено: race condition, APScheduler, subscription lifecycle, auth онбординга, безопасность токена бота)
> Дата: 2026-05-20
> Стек: FastAPI (Python 3.12) · PostgreSQL 16 · Cloudflare R2 · Telegram Webhooks

---

## Концепция одной фразой

**Один бэкенд на всех. Каждый мастер — изолированный тенант с собственным ботом, брендом и клиентами.**

---

## Роли в системе

| Роль | Кто | Что видит / может делать |
|------|-----|--------------------------|
| **Platform Admin** | Владелец платформы | Все мастера, все подписки, все данные |
| **Master** | Бьюти-мастер | Только свои данные: услуги, расписание, клиенты, записи |
| **Client** | Клиент мастера | Только профиль и услуги конкретного мастера; свои записи |

---

## Архитектурные решения (с обоснованием)

| Решение | Выбор | Почему |
|---------|-------|--------|
| Мультитенантность | Одна БД + `master_id` во всех таблицах | Один деплой, лёгкий старт; изоляция через row-level проверки в каждом запросе |
| Бот мастера | Каждый регистрирует свой токен через защищённую форму в Mini App | Его брендированный бот; токен НЕ передаётся через чат |
| Вебхук бота | `POST /webhook/{random_uuid}` + верификация по заголовку `X-Telegram-Bot-Api-Secret-Token` | Токен бота не попадает в URL и в логи |
| Фронтенд | Один SPA, читает `master_slug` из URL | `https://app.domain.com/m/kate-nails` |
| Хранение фото | Cloudflare R2 (S3-совместимо) через presigned URL | Бесплатно до 10 GB; загрузка напрямую с клиента, не через API |
| Оплата подписки | Telegram Payments (Stars или ЮKassa) через бот мастера | Нативно, без редиректов |
| Фоновые задачи | Отдельный процесс `worker.py` + `SELECT FOR UPDATE SKIP LOCKED` | Исключает дублирование уведомлений при нескольких воркерах API |
| Конфликт при бронировании | `UNIQUE INDEX` на `(master_id, date, time_start)` + транзакция с `SELECT FOR UPDATE` | Полностью исключает двойные записи на уровне БД |

---

## Схема базы данных

### `masters` — аккаунты мастеров (главная таблица тенанта)

```sql
CREATE TABLE masters (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id     BIGINT UNIQUE NOT NULL,
    slug                 VARCHAR(60) UNIQUE NOT NULL,   -- генерируется автоматически: transliterate(name) + random suffix если занято

    -- Бот мастера
    bot_token            TEXT UNIQUE,                   -- хранится зашифрованным (AES-256 через SECRET_KEY из env)
    bot_username         VARCHAR(100),                  -- @kate_nails_bot, берётся из getMe после сохранения токена
    bot_webhook_path     VARCHAR(100) UNIQUE,           -- случайный UUID: '/webhook/f47ac10b-58cc...'
    bot_webhook_secret   VARCHAR(100),                  -- случайная строка 32 символа; отправляется в setWebhook как secret_token

    -- Публичный профиль
    name                 VARCHAR(100) NOT NULL,
    specialty            VARCHAR(100),
    city                 VARCHAR(100),
    metro                VARCHAR(100),
    bio                  TEXT,
    avatar_url           TEXT,
    experience_years     INT,
    rating               NUMERIC(3,2) DEFAULT 5.0,
    reviews_count        INT DEFAULT 0,
    status               VARCHAR(20) DEFAULT 'active'
                         CHECK (status IN ('active', 'busy', 'paused')),
    status_text          VARCHAR(200),
    busy_until           DATE,

    -- Подписка
    plan                 VARCHAR(20) DEFAULT 'free'
                         CHECK (plan IN ('free', 'pro')),
    plan_expires_at      TIMESTAMPTZ,                   -- NULL на free
    plan_warning_sent    BOOLEAN DEFAULT FALSE,         -- флаг: предупреждение за 7 дней отправлено

    -- Тема (White Label, только pro)
    theme_id             UUID REFERENCES themes(id),
    custom_accent_color  VARCHAR(7),

    -- Системное
    onboarding_step      SMALLINT DEFAULT 0             -- 0..5; 5 = завершён
                         CHECK (onboarding_step BETWEEN 0 AND 5),
    is_active            BOOLEAN DEFAULT TRUE,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

-- Триггер: автообновление updated_at
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_masters_updated_at
BEFORE UPDATE ON masters
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Замечания по реализации:**
- `bot_token` шифруется в Python через `cryptography.fernet` перед сохранением; ключ в `BOT_ENCRYPTION_KEY` в `.env`; в коде никогда не логируется
- `slug` генерируется при регистрации: `transliterate(name).lower().replace(' ', '-')`, если занят — добавляется `-{random 4 chars}`; мастер может изменить позже
- `bot_webhook_path` = `str(uuid4())`, генерируется при `setup-bot`; не зависит от токена
- `bot_webhook_secret` = `secrets.token_urlsafe(32)`, генерируется при `setup-bot`

---

### `services` — услуги мастера

```sql
CREATE TABLE services (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id       UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,

    category        VARCHAR(60),
    category_name   VARCHAR(100),
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    price_min       INT NOT NULL CHECK (price_min > 0),   -- в рублях (целое)
    price_max       INT CHECK (price_max IS NULL OR price_max >= price_min),
    price_text      VARCHAR(100),                         -- "от 2 500 ₽"; генерируется на сервере, не на клиенте
    duration_min    INT NOT NULL CHECK (duration_min > 0),
    duration_text   VARCHAR(50),                          -- "1 ч 30 мин"; генерируется на сервере
    emoji           VARCHAR(10),
    includes        TEXT[],
    sort_order      INT DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_services_master_active ON services(master_id, sort_order)
WHERE is_active = TRUE;
```

**Замечания по реализации:**
- `price_text` и `duration_text` генерируются в Python-хелпере при каждом сохранении — не принимаются от клиента
- Лимит 5 активных услуг на `free`: при `POST /api/master/services` проверяем `COUNT(*) WHERE master_id=? AND is_active=TRUE`; если >= 5 и `plan='free'` → `HTTP 402` с телом `{"error": "service_limit_reached", "limit": 5}`
- При истечении подписки (downgrade free): `UPDATE services SET is_active=FALSE WHERE master_id=? AND id NOT IN (SELECT id FROM services WHERE master_id=? AND is_active=TRUE ORDER BY sort_order LIMIT 5)` — скрываем всё, что выше 5, по порядку сортировки

---

### `service_photos` — фотографии к услуге

```sql
CREATE TABLE service_photos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id  UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_service_photos_service ON service_photos(service_id, sort_order);
```

**Замечания по реализации:**
- Загрузка фото: клиент запрашивает presigned URL через `GET /api/master/services/:id/photos/upload-url?filename=foto.jpg`; API генерирует presigned PUT-URL в R2 (TTL 10 мин); клиент делает PUT напрямую в R2; после успешной загрузки клиент вызывает `POST /api/master/services/:id/photos/confirm` с `{ r2_key }` — бэкенд сохраняет публичный URL в `service_photos`
- Максимум 10 фото на услугу; проверять при `confirm`
- Перед удалением записи из `service_photos` — удалять файл из R2 (через boto3 delete_object)

---

### `schedule` — рабочие часы мастера по дням недели

```sql
CREATE TABLE schedule (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id   UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),  -- 0=пн, 6=вс
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL CHECK (end_time > start_time),
    slot_length INT NOT NULL DEFAULT 30 CHECK (slot_length IN (15, 30, 60)),
    is_working  BOOLEAN DEFAULT TRUE,
    UNIQUE(master_id, day_of_week)
);
```

**Замечания по реализации:**
- При регистрации мастера заполняем дефолтное расписание: пн–пт 10:00–19:00, сб–вс выходные
- При `PUT /api/master/schedule` принимаем массив из 7 объектов (все дни)

---

### `blocked_slots` — ручная блокировка времени мастером

```sql
CREATE TABLE blocked_slots (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id   UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
    date        DATE NOT NULL,
    time_from   TIME NOT NULL,
    time_to     TIME NOT NULL CHECK (time_to > time_from),
    reason      VARCHAR(200),
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_blocked_master_date ON blocked_slots(master_id, date);
```

---

### `clients` — клиентская база мастера

```sql
CREATE TABLE clients (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id         UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
    telegram_user_id  BIGINT NOT NULL,
    first_name        VARCHAR(100),
    last_name         VARCHAR(100),
    username          VARCHAR(100),
    phone             VARCHAR(20),
    notes             TEXT,
    visits_count      INT DEFAULT 0 CHECK (visits_count >= 0),
    last_visit_at     DATE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(master_id, telegram_user_id)
);

CREATE INDEX idx_clients_master ON clients(master_id);
CREATE INDEX idx_clients_tg ON clients(telegram_user_id);  -- для поиска клиента по его tg_id
```

**Замечания по реализации:**
- `visits_count` инкрементируется триггером или явно при `PUT /api/master/appointments/:id/complete`
- Клиент создаётся при первом `POST /api/app/:slug/appointments`; при повторных записях — `INSERT ... ON CONFLICT (master_id, telegram_user_id) DO NOTHING`; затем `SELECT` для получения `client_id`

---

### `appointments` — записи клиентов

```sql
CREATE TABLE appointments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id         UUID NOT NULL REFERENCES masters(id),
    client_id         UUID NOT NULL REFERENCES clients(id),
    service_id        UUID NOT NULL REFERENCES services(id),

    date              DATE NOT NULL,
    time_start        TIME NOT NULL,
    time_end          TIME NOT NULL,      -- = time_start + interval '1 minute' * duration_min; вычисляется на сервере
    duration_min      INT NOT NULL CHECK (duration_min > 0),

    price             INT NOT NULL CHECK (price > 0),   -- зафиксирован на момент записи
    status            VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                      CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
    cancellation_reason TEXT,
    client_notes      TEXT,

    notified_24h      BOOLEAN DEFAULT FALSE,
    notified_2h       BOOLEAN DEFAULT FALSE,

    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- КРИТИЧНО: исключает двойное бронирование на уровне БД
CREATE UNIQUE INDEX idx_no_double_booking
ON appointments(master_id, date, time_start)
WHERE status = 'confirmed';

-- Для быстрого получения расписания мастера
CREATE INDEX idx_apt_master_date ON appointments(master_id, date)
WHERE status = 'confirmed';

-- Для экрана "Мои записи" клиента
CREATE INDEX idx_apt_client ON appointments(client_id, date);

-- Триггер updated_at
CREATE TRIGGER trg_appointments_updated_at
BEFORE UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

**Замечания по реализации:**
- `time_end` вычисляется на сервере: `time_start + timedelta(minutes=service.duration_min)`; клиент не передаёт `time_end`
- Алгоритм создания записи — см. раздел "Атомарное бронирование" ниже

---

### `themes` — темы оформления

```sql
CREATE TABLE themes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    preview_url     TEXT,
    accent_color    VARCHAR(7) NOT NULL,
    bg_color        VARCHAR(7),
    button_color    VARCHAR(7),
    is_pro_only     BOOLEAN DEFAULT TRUE,
    sort_order      INT DEFAULT 0
);

-- Базовая тема доступна всем
INSERT INTO themes (id, name, accent_color, is_pro_only, sort_order)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Default',
    '#FF69B4',
    FALSE,
    0
);
```

---

### `subscriptions` — история платежей

```sql
CREATE TABLE subscriptions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id             UUID NOT NULL REFERENCES masters(id),
    plan                  VARCHAR(20) NOT NULL,
    amount                INT NOT NULL CHECK (amount > 0),
    currency              VARCHAR(10) DEFAULT 'RUB',
    starts_at             TIMESTAMPTZ NOT NULL,
    expires_at            TIMESTAMPTZ NOT NULL,
    tg_payment_charge_id  TEXT UNIQUE,     -- UNIQUE: защита от повторной обработки одного платежа
    status                VARCHAR(20) DEFAULT 'active'
                          CHECK (status IN ('active', 'expired', 'refunded')),
    created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sub_master ON subscriptions(master_id, expires_at);
```

---

### `notifications_queue` — очередь уведомлений

```sql
CREATE TABLE notifications_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id       UUID NOT NULL REFERENCES masters(id),
    appointment_id  UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    type            VARCHAR(20) NOT NULL
                    CHECK (type IN ('confirmation', 'reminder_24h', 'reminder_2h', 'cancellation')),
    recipient       VARCHAR(10) NOT NULL
                    CHECK (recipient IN ('client', 'master')),
    chat_id         BIGINT NOT NULL,
    scheduled_at    TIMESTAMPTZ NOT NULL,
    sent_at         TIMESTAMPTZ,
    status          VARCHAR(10) DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'failed')),
    retry_count     SMALLINT DEFAULT 0,
    error           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Частичный индекс: воркер читает только pending-задачи, отсортированные по времени
CREATE INDEX idx_notif_pending ON notifications_queue(scheduled_at)
WHERE status = 'pending';
```

---

## Атомарное бронирование (FIX #1: Race Condition)

Алгоритм `POST /api/app/:slug/appointments` — выполняется внутри одной транзакции:

```python
async def create_appointment(master_id, service_id, date, time_start, client_notes, telegram_user):
    async with db.transaction():  # BEGIN

        # 1. Получаем услугу и проверяем принадлежность мастеру
        service = await db.fetchrow(
            "SELECT * FROM services WHERE id=$1 AND master_id=$2 AND is_active=TRUE",
            service_id, master_id
        )
        if not service:
            raise HTTP404("Service not found")

        # 2. Проверяем расписание мастера на этот день
        schedule = await db.fetchrow(
            "SELECT * FROM schedule WHERE master_id=$1 AND day_of_week=$2 AND is_working=TRUE",
            master_id, date.weekday()
        )
        if not schedule:
            raise HTTP409("Master does not work on this day")

        # 3. БЛОКИРУЕМ строки уже существующих записей на эту дату
        #    SELECT FOR UPDATE не даёт другим транзакциям вставить запись
        #    пока мы не закончим проверку.
        existing = await db.fetch(
            """
            SELECT time_start, time_end FROM appointments
            WHERE master_id=$1 AND date=$2 AND status='confirmed'
            FOR UPDATE
            """,
            master_id, date
        )

        # 4. Проверяем, что слот не занят (пересечение временных интервалов)
        time_end = (
            datetime.combine(date, time_start) + timedelta(minutes=service['duration_min'])
        ).time()

        for row in existing:
            # Пересечение: новый слот начинается ДО конца существующего
            #              И заканчивается ПОСЛЕ начала существующего
            if time_start < row['time_end'] and time_end > row['time_start']:
                raise HTTP409("This slot is already booked")

        # 5. Проверяем заблокированные слоты
        blocked = await db.fetch(
            """
            SELECT time_from, time_to FROM blocked_slots
            WHERE master_id=$1 AND date=$2
            """,
            master_id, date
        )
        for row in blocked:
            if time_start < row['time_to'] and time_end > row['time_from']:
                raise HTTP409("This slot is blocked by master")

        # 6. Upsert клиента (INSERT если новый, иначе вернуть существующего)
        client = await db.fetchrow(
            """
            INSERT INTO clients (master_id, telegram_user_id, first_name, username)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (master_id, telegram_user_id) DO UPDATE
              SET first_name = EXCLUDED.first_name,
                  username   = EXCLUDED.username
            RETURNING id
            """,
            master_id, telegram_user['id'], telegram_user['first_name'], telegram_user.get('username')
        )

        # 7. Создаём запись
        #    UNIQUE INDEX idx_no_double_booking — последний рубеж защиты:
        #    если две транзакции прошли шаг 3 одновременно (маловероятно, но возможно),
        #    одна из них получит UniqueViolation и откатится.
        try:
            appointment = await db.fetchrow(
                """
                INSERT INTO appointments
                  (master_id, client_id, service_id, date, time_start, time_end,
                   duration_min, price, client_notes)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING *
                """,
                master_id, client['id'], service_id, date, time_start, time_end,
                service['duration_min'], service['price_min'], client_notes
            )
        except UniqueViolationError:
            # Гонка: другая транзакция успела вставить этот слот раньше
            raise HTTP409("This slot was just taken. Please choose another time.")

        # 8. Создаём задачи уведомлений
        apt_datetime = datetime.combine(date, time_start)
        notifications = [
            # Подтверждение клиенту — немедленно
            ('confirmation', 'client', telegram_user['id'], datetime.utcnow()),
            # Подтверждение мастеру — немедленно
            ('confirmation', 'master', master['chat_id'], datetime.utcnow()),
            # Напоминание клиенту за 24 ч
            ('reminder_24h', 'client', telegram_user['id'], apt_datetime - timedelta(hours=24)),
            # Напоминание клиенту за 2 ч
            ('reminder_2h',  'client', telegram_user['id'], apt_datetime - timedelta(hours=2)),
        ]
        await db.executemany(
            """
            INSERT INTO notifications_queue
              (master_id, appointment_id, type, recipient, chat_id, scheduled_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            """,
            [(master_id, appointment['id'], t, r, cid, sa) for t, r, cid, sa in notifications]
        )

        # COMMIT происходит автоматически при выходе из блока transaction()
        return appointment
```

**Почему это безопасно:**
- `SELECT FOR UPDATE` блокирует все confirmed-записи мастера на эту дату — конкурирующая транзакция ждёт
- `UNIQUE INDEX idx_no_double_booking` — страховка от маловероятной гонки при одновременном старте двух транзакций
- `UniqueViolationError` перехватывается и возвращается пользователю как 409, не как 500

---

## Фоновый воркер уведомлений (FIX #2: APScheduler + multi-worker)

### Почему отдельный процесс

FastAPI запускается с несколькими воркерами (`uvicorn --workers 4`). Если APScheduler работает внутри каждого воркера — все четыре будут читать и отправлять одни и те же уведомления. Клиент получит 4 одинаковых сообщения.

**Решение:** `worker.py` — отдельная точка входа, запускается как один процесс. Никогда не запускать с `--workers > 1`.

### Файл `worker.py`

```python
"""
Запуск: python worker.py
Один процесс. Работает рядом с API-сервером.
supervisor / systemd держат его живым.
"""
import asyncio
import asyncpg
from datetime import datetime
from config import DATABASE_URL

BATCH_SIZE = 50
INTERVAL_SECONDS = 60


async def process_notifications(pool: asyncpg.Pool):
    async with pool.acquire() as conn:
        async with conn.transaction():
            # FOR UPDATE SKIP LOCKED: каждая строка берётся только одним воркером.
            # Если воркеров несколько (будущее масштабирование) — не будет дублей.
            rows = await conn.fetch(
                """
                SELECT nq.*, m.bot_token, m.bot_webhook_secret
                FROM notifications_queue nq
                JOIN masters m ON m.id = nq.master_id
                WHERE nq.status = 'pending'
                  AND nq.scheduled_at <= $1
                  AND nq.retry_count < 3
                ORDER BY nq.scheduled_at
                LIMIT $2
                FOR UPDATE OF nq SKIP LOCKED
                """,
                datetime.utcnow(), BATCH_SIZE
            )

            for row in rows:
                success = await send_notification(row)
                if success:
                    await conn.execute(
                        "UPDATE notifications_queue SET status='sent', sent_at=$1 WHERE id=$2",
                        datetime.utcnow(), row['id']
                    )
                else:
                    await conn.execute(
                        """
                        UPDATE notifications_queue
                        SET retry_count = retry_count + 1,
                            status = CASE WHEN retry_count + 1 >= 3 THEN 'failed' ELSE 'pending' END,
                            error = $1
                        WHERE id = $2
                        """,
                        "Send failed", row['id']
                    )


async def send_notification(row) -> bool:
    """Отправляет сообщение через бот мастера. Возвращает True при успехе."""
    text = build_message_text(row['type'], row['recipient'])
    try:
        await telegram_send_message(
            bot_token=decrypt_token(row['bot_token']),
            chat_id=row['chat_id'],
            text=text
        )
        return True
    except Exception as e:
        print(f"Notification {row['id']} failed: {e}")
        return False


async def main():
    pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=3)
    print("Worker started. Polling every 60 seconds.")
    while True:
        try:
            await process_notifications(pool)
        except Exception as e:
            print(f"Worker error: {e}")
        await asyncio.sleep(INTERVAL_SECONDS)


if __name__ == "__main__":
    asyncio.run(main())
```

### Конфигурация supervisor (systemd-альтернатива)

```ini
# /etc/supervisor/conf.d/beauty-worker.conf
[program:beauty-worker]
command=python /srv/beauty/worker.py
directory=/srv/beauty
autostart=true
autorestart=true
stdout_logfile=/var/log/beauty/worker.log
stderr_logfile=/var/log/beauty/worker-err.log
```

---

## Lifecycle подписки (FIX #3: что происходит при истечении)

### Полный жизненный цикл

```
free  ──────────────────────────────────────────────────────► free (навсегда)
         Мастер оплачивает → successful_payment
         ↓
pro   ─── NOW() + 30 дней ──► [за 7 дней до] ──► [в день X] ──► downgrade to free
```

### Шаг 1: Активация pro (при получении successful_payment)

```python
async def activate_subscription(master_id, charge_id, amount):
    # Защита от дублей: UNIQUE на tg_payment_charge_id
    exists = await db.fetchval(
        "SELECT 1 FROM subscriptions WHERE tg_payment_charge_id=$1", charge_id
    )
    if exists:
        return  # уже обработано (idempotent)

    now = datetime.utcnow()
    expires = now + timedelta(days=30)

    async with db.transaction():
        await db.execute(
            """
            INSERT INTO subscriptions
              (master_id, plan, amount, starts_at, expires_at, tg_payment_charge_id)
            VALUES ($1, 'pro', $2, $3, $4, $5)
            """,
            master_id, amount, now, expires, charge_id
        )
        await db.execute(
            """
            UPDATE masters
            SET plan='pro',
                plan_expires_at=$1,
                plan_warning_sent=FALSE
            WHERE id=$2
            """,
            expires, master_id
        )
    # Отправить мастеру подтверждение через его бота
    await notify_master_subscription_active(master_id, expires)
```

### Шаг 2: Ежедневный воркер проверки подписок

Запускается в `worker.py` раз в сутки (в 03:00 UTC, когда нагрузка минимальна):

```python
async def check_subscriptions(pool):
    now = datetime.utcnow()

    # --- 2а. Предупреждение за 7 дней ---
    warning_candidates = await pool.fetch(
        """
        SELECT id, bot_token, plan_expires_at
        FROM masters
        WHERE plan = 'pro'
          AND plan_warning_sent = FALSE
          AND plan_expires_at BETWEEN $1 AND $2
        """,
        now, now + timedelta(days=7)
    )
    for master in warning_candidates:
        await send_subscription_warning(master)
        await pool.execute(
            "UPDATE masters SET plan_warning_sent=TRUE WHERE id=$1", master['id']
        )

    # --- 2б. Понижение до free при истечении ---
    expired = await pool.fetch(
        """
        SELECT id FROM masters
        WHERE plan = 'pro'
          AND plan_expires_at < $1
        """,
        now
    )
    for master in expired:
        await downgrade_to_free(pool, master['id'])


async def downgrade_to_free(pool, master_id):
    async with pool.acquire() as conn:
        async with conn.transaction():
            # 1. Скрываем услуги сверх 5 (по sort_order; меньший sort_order = приоритетнее)
            #    Услуги НЕ удаляются — мастер может продлить подписку и они снова появятся
            await conn.execute(
                """
                UPDATE services SET is_active = FALSE
                WHERE master_id = $1
                  AND id NOT IN (
                      SELECT id FROM services
                      WHERE master_id = $1 AND is_active = TRUE
                      ORDER BY sort_order, created_at
                      LIMIT 5
                  )
                """,
                master_id
            )

            # 2. Сбрасываем тему на default
            await conn.execute(
                """
                UPDATE masters
                SET plan = 'free',
                    plan_expires_at = NULL,
                    plan_warning_sent = FALSE,
                    theme_id = '00000000-0000-0000-0000-000000000001',
                    custom_accent_color = NULL
                WHERE id = $1
                """,
                master_id
            )

        # 3. Уведомляем мастера
        await send_subscription_expired_notice(master_id)
```

### Правила downgrade (явно зафиксировано)

| Ресурс | Что происходит при истечении pro |
|--------|----------------------------------|
| Услуги 1–5 | Остаются активными |
| Услуги 6+ | `is_active = FALSE` (скрыты от клиентов, НЕ удалены) |
| Тема | Сбрасывается на `Default` |
| Уже созданные записи | Не затрагиваются (остаются подтверждёнными) |
| Новые записи | Доступны без ограничений (бронирование не требует pro) |
| Grace period | 0 дней (downgrade мгновенный в день истечения) |

---

## Аутентификация (FIX #4: Онбординг без авторизации)

### Два типа токенов в системе

| Тип | Где живёт | Как получить | Проверяется в |
|-----|-----------|--------------|---------------|
| `initData` HMAC | Передаётся в каждом запросе в заголовке `X-Telegram-Init-Data` | Telegram генерирует при открытии Mini App | Все эндпоинты, кроме полностью публичных |
| JWT мастера | Cookie `httpOnly` или `Authorization: Bearer` | Выдаётся после верификации initData | `/api/master/` и `/api/onboarding/` |

### Как проверяется initData

```python
import hashlib, hmac
from urllib.parse import parse_qsl, unquote

def verify_init_data(init_data_raw: str, bot_token: str) -> dict:
    """
    Возвращает распарсенный словарь с данными пользователя или бросает исключение.
    """
    parsed = dict(parse_qsl(init_data_raw, keep_blank_values=True))
    received_hash = parsed.pop('hash', None)
    if not received_hash:
        raise ValueError("No hash in initData")

    data_check_string = "\n".join(
        f"{k}={v}" for k, v in sorted(parsed.items())
    )
    secret_key = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected_hash, received_hash):
        raise ValueError("Invalid initData signature")

    # Проверяем давность (не старше 1 часа)
    if abs(time.time() - int(parsed['auth_date'])) > 3600:
        raise ValueError("initData expired")

    import json
    parsed['user'] = json.loads(unquote(parsed['user']))
    return parsed
```

### Схема аутентификации онбординга (полная)

```
Шаг 0: Мастер пишет /start в @yoursaas_bot
        ↓
        Бот вызывает внутренний эндпоинт:
        POST /internal/onboarding/register
          Headers: X-Internal-Secret: {INTERNAL_API_SECRET из env}
          Body: { telegram_user_id, first_name, username }
        ↓
        Бэкенд создаёт master (onboarding_step=0)
        Выдаёт JWT с { master_id, telegram_user_id, role: 'master' }
        Бот сохраняет JWT во временном хранилище (Redis или in-memory dict)
        ↓
        Бот отправляет мастеру ссылку на онбординг Mini App:
        https://app.domain.com/setup?token={JWT}
        (JWT в URL — только для онбординга; после завершения заменяется на cookie)

Шаги 1–5: Все запросы из онбординг-Mini App содержат:
        Authorization: Bearer {JWT}
        ↓
        Middleware извлекает master_id из JWT
        master_id берётся ТОЛЬКО из JWT, НЕ из тела запроса

Финальный JWT (после завершения онбординга):
        Выдаётся при каждом открытии Mini App мастером через initData:
        POST /api/auth/master-token
          Headers: X-Telegram-Init-Data: {initData}  (верифицируем через BOT_TOKEN платформы)
          → если telegram_user_id найден в masters → выдаём JWT { master_id, role: 'master' }
          → если не найден → 403 (нужно сначала зарегистрироваться)
```

### Внутренний эндпоинт для бота платформы

```python
# Доступен ТОЛЬКО с localhost или через INTERNAL_API_SECRET
# Не выставлять наружу через nginx

@router.post("/internal/onboarding/register")
async def internal_register(
    data: InternalRegisterSchema,
    secret: str = Header(alias="X-Internal-Secret")
):
    if secret != settings.INTERNAL_API_SECRET:
        raise HTTP403("Forbidden")
    # ... создаём мастера
```

---

## Безопасность вебхуков и хранения токена бота (FIX #5)

### Проблема которую исправляем

**Было:** URL вебхука содержал `{bot_token_hash}` → токен попадает в логи nginx и Telegram.

**Было:** Мастер отправлял токен текстом в чат Telegram → риск утечки через пересылку сообщений.

### Как теперь хранится и передаётся токен бота

```
1. Мастер открывает Mini App платформы (онбординг, шаг 2)
2. В Mini App — форма с полем "Введите токен бота"
3. Мастер вставляет токен в поле формы
4. Mini App делает HTTPS-запрос:
   POST /api/onboarding/setup-bot
     Authorization: Bearer {JWT}                ← master_id берётся из JWT
     Content-Type: application/json
     Body: { "bot_token": "7123456789:AAFxxx..." }
5. Сервер:
   а) Проверяет JWT → получает master_id
   б) Вызывает Telegram API: GET https://api.telegram.org/bot{token}/getMe
      → если ошибка → 400 Bad Request, токен неверный
   в) Шифрует токен: encrypted = Fernet(BOT_ENCRYPTION_KEY).encrypt(token.encode())
   г) Генерирует webhook_path = str(uuid4())    ← случайный, не связан с токеном
   д) Генерирует webhook_secret = secrets.token_urlsafe(32)
   е) Сохраняет в masters: bot_token=encrypted, bot_webhook_path=webhook_path, bot_webhook_secret=webhook_secret
   ж) Вызывает Telegram API:
      POST https://api.telegram.org/bot{token}/setWebhook
        url: "https://api.domain.com/webhook/{webhook_path}"
        secret_token: "{webhook_secret}"
        allowed_updates: ["message", "pre_checkout_query", "successful_payment"]
   з) Отвечает: { "bot_username": "@kate_nails_bot", "status": "ok" }
```

### URL и проверка входящих вебхуков

```python
@router.post("/webhook/{webhook_path}")
async def telegram_webhook(
    webhook_path: str,
    update: dict = Body(...),
    secret_header: str = Header(alias="X-Telegram-Bot-Api-Secret-Token", default=None)
):
    # 1. Находим мастера по webhook_path (не по токену)
    master = await db.fetchrow(
        "SELECT * FROM masters WHERE bot_webhook_path=$1 AND is_active=TRUE",
        webhook_path
    )
    if not master:
        raise HTTP404()  # неизвестный путь → тихо игнорируем

    # 2. Проверяем заголовок-секрет
    if not secret_header or secret_header != master['bot_webhook_secret']:
        raise HTTP403()  # запрос не от Telegram

    # 3. Получаем и используем токен только здесь, в памяти
    bot_token = Fernet(BOT_ENCRYPTION_KEY).decrypt(master['bot_token']).decode()

    # 4. Обрабатываем update
    await dispatch_update(update, master, bot_token)

    return Response(status_code=200)
```

**Ключевые свойства:**
- `webhook_path` — случайный UUID, не выводимый из токена
- Токен расшифровывается только в момент обработки, не кешируется
- Проверка заголовка `X-Telegram-Bot-Api-Secret-Token` — Telegram подписывает каждый запрос
- Токен никогда не попадает в логи (nginx логирует только путь `/webhook/{uuid}`)

---

## API — полная карта эндпоинтов

### Условные обозначения авторизации

| Пометка | Что требует |
|---------|-------------|
| `[public]` | Без авторизации |
| `[initData]` | Заголовок `X-Telegram-Init-Data` + HMAC-верификация |
| `[jwt-master]` | Заголовок `Authorization: Bearer {JWT}` с `role=master` |
| `[internal]` | Заголовок `X-Internal-Secret` (только между ботом и API на одном сервере) |

---

### 1. Онбординг мастера

```
[internal] POST /internal/onboarding/register
  Body: { telegram_user_id, first_name, username }
  → Создаёт master (onboarding_step=0), возвращает JWT

[jwt-master] POST /api/onboarding/setup-bot
  Body: { bot_token }
  → Проверяет токен (getMe), шифрует, генерирует webhook_path + webhook_secret,
    регистрирует вебхук, сохраняет bot_username, onboarding_step=2

[jwt-master] POST /api/onboarding/profile
  Body: { name, specialty, city, metro, bio }
  → Обновляет профиль, генерирует slug (если не задан), onboarding_step=3

[jwt-master] POST /api/onboarding/schedule
  Body: [{ day_of_week, start_time, end_time, slot_length, is_working }] × 7
  → Заменяет расписание полностью (upsert), onboarding_step=4

[jwt-master] POST /api/onboarding/complete
  → Устанавливает onboarding_step=5, отправляет тестовое сообщение в бот мастера
```

---

### 2. Авторизация мастера

```
[initData] POST /api/auth/master-token
  Headers: X-Telegram-Init-Data: {initData}
  → Верифицирует initData через BOT_TOKEN платформы (@yoursaas_bot)
  → Ищет master по telegram_user_id
  → Возвращает JWT { master_id, role: 'master', exp: +24h }
  → Если мастер не найден → 403
```

---

### 3. Профиль мастера (управление)

```
[jwt-master] GET  /api/master/profile
[jwt-master] PUT  /api/master/profile
  Body: { name, specialty, city, metro, bio, status, status_text, busy_until }

[jwt-master] GET  /api/master/upload-avatar-url
  → Возвращает presigned PUT URL в R2 (TTL 10 мин) + r2_key

[jwt-master] POST /api/master/confirm-avatar
  Body: { r2_key }
  → Валидирует что файл существует в R2, сохраняет публичный URL в masters.avatar_url

[jwt-master] GET  /api/master/schedule
[jwt-master] PUT  /api/master/schedule
  Body: [{ day_of_week, start_time, end_time, slot_length, is_working }] × 7

[jwt-master] POST /api/master/blocked-slots
  Body: { date, time_from, time_to, reason }
[jwt-master] DELETE /api/master/blocked-slots/:id

[jwt-master] GET  /api/master/stats
  → { total_clients, appointments_this_month, revenue_this_month, upcoming_today }
```

---

### 4. Услуги мастера (управление)

```
[jwt-master] GET    /api/master/services
[jwt-master] POST   /api/master/services
  Body: { category, category_name, name, description, price_min, price_max,
          duration_min, emoji, includes: [] }
  → Проверяет лимит (5 на free) → 402 если превышен
  → price_text и duration_text генерирует сервер

[jwt-master] PUT    /api/master/services/:id
[jwt-master] DELETE /api/master/services/:id   → soft delete (is_active=FALSE)
[jwt-master] PUT    /api/master/services/reorder
  Body: { order: [service_id, ...] }   → обновляет sort_order

[jwt-master] GET    /api/master/services/:id/upload-photo-url?filename=foto.jpg
  → Presigned PUT URL (R2, TTL 10 мин)
[jwt-master] POST   /api/master/services/:id/confirm-photo
  Body: { r2_key, sort_order }
  → Сохраняет URL в service_photos
[jwt-master] DELETE /api/master/services/:id/photos/:photo_id
  → Удаляет из service_photos + удаляет файл из R2
[jwt-master] PUT    /api/master/services/:id/photos/reorder
  Body: { order: [photo_id, ...] }
```

---

### 5. Записи мастера (управление)

```
[jwt-master] GET  /api/master/appointments
  ?date=YYYY-MM-DD   → записи за конкретный день
  ?from=&to=         → диапазон дат
  ?status=confirmed  → фильтр по статусу

[jwt-master] GET  /api/master/appointments/:id
[jwt-master] PUT  /api/master/appointments/:id/cancel
  Body: { reason }
  → Меняет status='cancelled', добавляет задачу в notifications_queue (тип: cancellation)

[jwt-master] PUT  /api/master/appointments/:id/complete
  → status='completed', инкремент clients.visits_count, обновление clients.last_visit_at

[jwt-master] PUT  /api/master/appointments/:id/no-show
  → status='no_show'
```

---

### 6. Клиенты мастера

```
[jwt-master] GET  /api/master/clients
  ?search=Анна   → поиск по имени/username

[jwt-master] GET  /api/master/clients/:id
  → { ...client, appointments: [ последние 10 ] }

[jwt-master] PUT  /api/master/clients/:id/notes
  Body: { notes }
```

---

### 7. Подписка

```
[jwt-master] GET  /api/master/subscription
  → { plan, plan_expires_at, services_used, services_limit, days_left }

[jwt-master] POST /api/master/subscription/invoice
  → Отправляет Telegram Invoice мастеру через его бота (через бот платформы?)
  ВАЖНО: invoice отправляет бот платформы (@yoursaas_bot) напрямую мастеру,
         потому что в момент нажатия кнопки мастер взаимодействует с Mini App,
         а не с ботом; после оплаты бот платформы получает successful_payment

[jwt-master] GET  /api/master/themes
  → Все темы; помечает is_available=true только для pro (если мастер на free → только Default)

[jwt-master] PUT  /api/master/theme
  Body: { theme_id }
  → Проверяет: plan='pro'; тема существует; обновляет masters.theme_id
```

---

### 8. Публичный API Mini App (для клиентов)

```
[public]  GET  /api/app/:slug/profile
  → { name, specialty, city, metro, avatar_url, rating, reviews_count,
      status, status_text, theme: { accent_color, bg_color, button_color } }

[public]  GET  /api/app/:slug/services
  ?category=manicure
  → Только is_active=TRUE услуги; обложка = первое фото; отсортированы по sort_order

[public]  GET  /api/app/:slug/services/:id
  → { ...full service, photos: [ { url, sort_order } ], includes: [] }

[public]  GET  /api/app/:slug/slots
  ?date=YYYY-MM-DD&service_id=UUID
  → { date, slots: [ { time, available } ] }
  Логика: расписание + confirmed записи + blocked_slots → см. алгоритм ниже

[initData] POST /api/app/:slug/appointments
  Headers: X-Telegram-Init-Data: {initData}
  Body: { service_id, date, time, client_notes }
  → Атомарное бронирование (см. раздел выше)
  → 200: { appointment_id, date, time_start, time_end, service_name, price }
  → 409: слот занят
  → 402: мастер неактивен / приостановил записи

[initData] GET  /api/app/:slug/my-appointments
  → { upcoming: [...], history: [...] }
  Клиент идентифицируется по telegram_user_id из initData

[initData] DELETE /api/app/:slug/appointments/:id
  → Отмена только своей confirmed-записи
  → Добавляет уведомление мастеру (тип: cancellation)
```

---

### 9. Вебхуки Telegram (все боты)

```
[webhook-secret] POST /webhook/:webhook_path
  → Роутинг по bot_webhook_path → находит мастера
  → Верифицирует X-Telegram-Bot-Api-Secret-Token == master.bot_webhook_secret
  → Расшифровывает bot_token из БД
  → Диспетчеризирует update:

  /start                  → приветствие + кнопка Mini App мастера
  /appointments           → список предстоящих записей клиента (через API)
  /help                   → краткая инструкция
  pre_checkout_query      → немедленный ответ answerPreCheckoutQuery(ok=True)
  successful_payment      → activate_subscription(master_id, charge_id, amount)
```

---

## Алгоритм генерации слотов

```python
def get_available_slots(
    schedule: ScheduleRow,
    appointments: list[AppointmentRow],
    blocked: list[BlockedSlotRow],
    service_duration_min: int
) -> list[dict]:
    """
    Возвращает список { time: "10:00", available: True/False }
    """
    all_slots = []
    current = datetime.combine(date.today(), schedule.start_time)
    end = datetime.combine(date.today(), schedule.end_time)

    while current + timedelta(minutes=service_duration_min) <= end:
        t = current.time()
        slot_end = (current + timedelta(minutes=service_duration_min)).time()

        # Пересечение с confirmed записями
        booked = any(
            t < apt.time_end and slot_end > apt.time_start
            for apt in appointments
        )

        # Пересечение с заблокированными слотами
        blocked_by_master = any(
            t < bl.time_to and slot_end > bl.time_from
            for bl in blocked
        )

        all_slots.append({
            "time": t.strftime("%H:%M"),
            "available": not booked and not blocked_by_master
        })

        current += timedelta(minutes=schedule.slot_length)

    return all_slots
```

---

## Безопасность — сводная таблица

| Механизм | Где применяется | Детали |
|----------|----------------|--------|
| HMAC-SHA256 верификация initData | Все `[initData]` эндпоинты | Используем bot_token платформы (@yoursaas_bot) для клиентского API; токены мастеров только для вебхуков |
| JWT для мастера | Все `[jwt-master]` эндпоинты | Алгоритм HS256; `exp=24h`; `master_id` не принимается из body запроса |
| `X-Internal-Secret` | `/internal/` эндпоинты | Длинный random секрет из env; nginx блокирует внешние запросы на `/internal/` |
| Шифрование bot_token | БД | `cryptography.Fernet` (AES-128-CBC + HMAC); ключ только в env |
| Webhook secret header | `/webhook/:path` | `X-Telegram-Bot-Api-Secret-Token` из `secrets.token_urlsafe(32)` |
| Случайный UUID в webhook URL | `/webhook/:path` | Не связан с токеном; не выводим из публичных данных |
| Rate limiting | Все публичные эндпоинты | 60 req/min на IP (nginx `limit_req_zone`) |
| UNIQUE на tg_payment_charge_id | `subscriptions` | Защита от дублирования платежа при повторном вебхуке |
| `SELECT FOR UPDATE` + UNIQUE INDEX | `POST .../appointments` | Исключает двойное бронирование при конкурентных запросах |
| `FOR UPDATE SKIP LOCKED` | Воркер уведомлений | Исключает дубликаты при нескольких воркерах |
| row-level проверка master_id | Все `[jwt-master]` эндпоинты | Каждый запрос: `WHERE id=$1 AND master_id=$2` |

---

## Стек и деплой

| Компонент | Технология |
|-----------|-----------|
| Backend API | **FastAPI** (Python 3.12) |
| База данных | **PostgreSQL 16** + asyncpg (async) + SQLAlchemy 2.0 (опционально) |
| Миграции | **Alembic** |
| Фоновые задачи | **worker.py** — отдельный asyncio-процесс, запускается через supervisor |
| Хранилище фото | **Cloudflare R2** (boto3 совместим) |
| Авторизация | **PyJWT** (HS256) + HMAC для initData + Fernet для токенов |
| Бот платформы | **python-telegram-bot v21** (async) |
| Шифрование | **cryptography** (Fernet) |
| Деплой API | VPS → nginx → **uvicorn** (`--workers 4` — воркеры только для API) |
| Деплой воркера | supervisor → **python worker.py** (`--workers 1` всегда) |
| HTTPS | Let's Encrypt (certbot auto-renewal) |

---

## Конфигурация nginx (важные детали)

```nginx
# Блокируем /internal/ снаружи
location /internal/ {
    allow 127.0.0.1;
    deny all;
}

# Rate limiting
limit_req_zone $binary_remote_addr zone=api:10m rate=60r/m;
location /api/ {
    limit_req zone=api burst=20 nodelay;
    proxy_pass http://127.0.0.1:8000;
}

# Вебхуки — без rate limiting (Telegram сам контролирует частоту)
location /webhook/ {
    proxy_pass http://127.0.0.1:8000;
}
```

---

## Переменные окружения (.env)

```bash
# БД
DATABASE_URL=postgresql://user:pass@localhost:5432/beauty

# Telegram
PLATFORM_BOT_TOKEN=7xxx:AAFyyy          # токен @yoursaas_bot (бот платформы)
INTERNAL_API_SECRET=random-64-char      # секрет для /internal/ эндпоинтов

# Шифрование токенов мастеров
BOT_ENCRYPTION_KEY=base64-encoded-32-byte-fernet-key

# JWT
JWT_SECRET=random-64-char-string
JWT_ALGORITHM=HS256

# R2 / S3
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=beauty-photos
R2_PUBLIC_URL=https://pub-xxx.r2.dev    # публичный CDN URL

# App
APP_BASE_URL=https://app.domain.com
API_BASE_URL=https://api.domain.com
```

---

## Порядок разработки

### Фаза 1 — Ядро (2 недели)

1. `models.py` — все таблицы, Alembic `initial_migration`
2. `config.py` — загрузка env, Fernet-ключ, настройки
3. `auth.py` — `verify_init_data()`, `create_jwt()`, `decode_jwt()`, middleware
4. `encryption.py` — `encrypt_token()`, `decrypt_token()` через Fernet
5. `worker.py` — основной цикл, `FOR UPDATE SKIP LOCKED`, `send_notification()`
6. Бот платформы: обработка `/start` → `/internal/onboarding/register`
7. Онбординг эндпоинты (шаги 0–5)
8. JWT-авторизация мастера (`POST /api/auth/master-token`)

### Фаза 2 — Услуги и расписание (1 неделя)

9. CRUD услуг + лимит 5 + проверка плана
10. Загрузка фото через presigned URL (R2)
11. CRUD расписания + blocked_slots
12. Алгоритм генерации слотов

### Фаза 3 — Публичный API и бронирование (1 неделя)

13. Публичные эндпоинты `/api/app/:slug/`
14. Атомарное бронирование с `SELECT FOR UPDATE` + `UNIQUE INDEX`
15. Создание клиента при первом бронировании (upsert)
16. Экран "Мои записи" клиента

### Фаза 4 — Уведомления (1 неделя)

17. `notifications_queue` + воркер (`FOR UPDATE SKIP LOCKED`)
18. Тексты сообщений: подтверждение, напоминание 24h/2h, отмена
19. Отправка через расшифрованный бот мастера
20. Retry-логика (до 3 попыток, потом `status='failed'`)

### Фаза 5 — Подписка (1 неделя)

21. Telegram Invoice через бот платформы
22. Обработка `pre_checkout_query` и `successful_payment`
23. `activate_subscription()` с проверкой на дубли (`tg_payment_charge_id UNIQUE`)
24. Воркер проверки подписок: предупреждение за 7 дней + `downgrade_to_free()`
25. Темы: таблица + выбор мастером (только pro)

### Фаза 6 — Дэшборд мастера (2 недели)

26. Мини-дэшборд в Mini App: вкладка "Мастер" (только если `telegram_user_id` мастера)
27. Расписание на сегодня/неделю
28. Список записей с фильтрами
29. База клиентов с заметками
30. Статистика: записей в месяц, выручка, новые клиенты

---

## Что НЕ входит в backend v1

| Исключено | Когда |
|-----------|-------|
| Онлайн-оплата клиентом за услугу (депозит) | v2 |
| Система отзывов | v2 |
| Аналитика / графики | v2 |
| Многоязычность | v2 |
| Перенос записи (reschedule) | v2 (сейчас клиент отменяет + создаёт новую) |
| Групповые записи (несколько клиентов на один слот) | не планируется |
| API для мобильного приложения | не планируется |
