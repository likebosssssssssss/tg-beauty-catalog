-- ============================================================
-- beauty-saas: SQL-схема базы данных
-- Supabase Dashboard → SQL Editor → New query → вставить → Run
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- ЧАСТЬ 1: СЛУЖЕБНАЯ ФУНКЦИЯ (автообновление поля updated_at)
-- ─────────────────────────────────────────────────────────────
-- Триггер-функция: при каждом UPDATE автоматически ставит текущее время.
-- Без неё пришлось бы обновлять updated_at вручную в каждом запросе.

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ─────────────────────────────────────────────────────────────
-- ЧАСТЬ 2: ТАБЛИЦЫ
-- Порядок важен: сначала таблицы без зависимостей,
-- потом те, что ссылаются на уже созданные.
-- ─────────────────────────────────────────────────────────────


-- 2.1 ТЕМЫ ОФОРМЛЕНИЯ
-- Хранит цветовые схемы (White Label). Создаём первой,
-- потому что таблица masters на неё ссылается.
CREATE TABLE themes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(100) NOT NULL,
    preview_url     TEXT,
    accent_color    VARCHAR(7) NOT NULL,       -- HEX цвет, например '#FF69B4'
    bg_color        VARCHAR(7),
    button_color    VARCHAR(7),
    is_pro_only     BOOLEAN DEFAULT TRUE,      -- FALSE только для Default
    sort_order      INT DEFAULT 0
);

-- Базовая тема: всегда доступна, используется при downgrade с pro → free.
-- ID зафиксирован константой, чтобы ссылаться на него в коде без запроса.
INSERT INTO themes (id, name, accent_color, is_pro_only, sort_order)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default', '#FF69B4', FALSE, 0);


-- 2.2 МАСТЕРА (главная таблица тенанта)
-- Каждый мастер = один изолированный арендатор платформы.
-- Все остальные таблицы содержат master_id и относятся только к нему.
CREATE TABLE masters (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    telegram_user_id     BIGINT UNIQUE NOT NULL,  -- Telegram ID мастера
    slug                 VARCHAR(60) UNIQUE NOT NULL, -- URL мастера: /m/kate-nails

    -- Бот мастера (заполняется на шаге онбординга "Подключить бота")
    bot_token            TEXT UNIQUE,              -- хранится зашифрованным через Fernet
    bot_username         VARCHAR(100),             -- @kate_nails_bot
    bot_webhook_path     VARCHAR(100) UNIQUE,      -- случайный UUID, не связан с токеном
    bot_webhook_secret   VARCHAR(100),             -- подпись Telegram-запросов

    -- Публичный профиль мастера
    name                 VARCHAR(100) NOT NULL,
    specialty            VARCHAR(100),             -- 'Nail-мастер', 'Бровист' и т.п.
    city                 VARCHAR(100),
    metro                VARCHAR(100),
    bio                  TEXT,
    avatar_url           TEXT,                     -- CDN-ссылка (Cloudflare R2)
    experience_years     INT,
    rating               NUMERIC(3,2) DEFAULT 5.0,
    reviews_count        INT DEFAULT 0,
    status               VARCHAR(20) DEFAULT 'active'
                         CHECK (status IN ('active', 'busy', 'paused')),
    status_text          VARCHAR(200),             -- 'Принимает записи'
    busy_until           DATE,

    -- Подписка
    plan                 VARCHAR(20) DEFAULT 'free'
                         CHECK (plan IN ('free', 'pro')),
    plan_expires_at      TIMESTAMPTZ,              -- NULL когда plan='free'
    plan_warning_sent    BOOLEAN DEFAULT FALSE,    -- предупреждение за 7 дней отправлено?

    -- Тема (White Label, только для pro)
    theme_id             UUID REFERENCES themes(id),
    custom_accent_color  VARCHAR(7),

    -- Прогресс онбординга: 0=начало, 5=завершён
    onboarding_step      SMALLINT DEFAULT 0
                         CHECK (onboarding_step BETWEEN 0 AND 5),
    is_active            BOOLEAN DEFAULT TRUE,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_masters_updated_at
BEFORE UPDATE ON masters
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- 2.3 УСЛУГИ МАСТЕРА
CREATE TABLE services (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id       UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,

    category        VARCHAR(60),
    category_name   VARCHAR(100),
    name            VARCHAR(200) NOT NULL,
    description     TEXT,
    price_min       INT NOT NULL CHECK (price_min > 0),
    price_max       INT CHECK (price_max IS NULL OR price_max >= price_min),
    price_text      VARCHAR(100),          -- генерируется сервером, не принимается от клиента
    duration_min    INT NOT NULL CHECK (duration_min > 0),
    duration_text   VARCHAR(50),           -- генерируется сервером
    emoji           VARCHAR(10),
    includes        TEXT[],                -- массив строк: что входит в услугу
    sort_order      INT DEFAULT 0,
    is_active       BOOLEAN DEFAULT TRUE,  -- FALSE = скрыта (soft delete)
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Частичный индекс: ускоряет выборку только активных услуг мастера
CREATE INDEX idx_services_master_active ON services(master_id, sort_order)
WHERE is_active = TRUE;


-- 2.4 ФОТОГРАФИИ К УСЛУГЕ
-- Фото хранятся в Cloudflare R2 (S3-совместимое хранилище).
-- Здесь только URL-ссылки на них.
CREATE TABLE service_photos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id  UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    sort_order  INT DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_service_photos_service ON service_photos(service_id, sort_order);


-- 2.5 РАСПИСАНИЕ МАСТЕРА (рабочие часы по дням недели)
-- 7 строк на мастера: по одной на каждый день недели.
-- 0 = понедельник, 6 = воскресенье.
CREATE TABLE schedule (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id   UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
    start_time  TIME NOT NULL,
    end_time    TIME NOT NULL CHECK (end_time > start_time),
    slot_length INT NOT NULL DEFAULT 30 CHECK (slot_length IN (15, 30, 60)),
    is_working  BOOLEAN DEFAULT TRUE,
    UNIQUE(master_id, day_of_week)         -- один день = одна строка на мастера
);


-- 2.6 ЗАБЛОКИРОВАННЫЕ СЛОТЫ
-- Мастер может вручную закрыть конкретное время (отпуск, выезд и т.п.).
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


-- 2.7 КЛИЕНТСКАЯ БАЗА МАСТЕРА
-- Клиент идентифицируется по Telegram user ID.
-- Один и тот же человек может быть клиентом разных мастеров —
-- это разные строки (UNIQUE по паре master_id + telegram_user_id).
CREATE TABLE clients (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id         UUID NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
    telegram_user_id  BIGINT NOT NULL,
    first_name        VARCHAR(100),
    last_name         VARCHAR(100),
    username          VARCHAR(100),
    phone             VARCHAR(20),
    notes             TEXT,              -- заметки мастера о клиенте
    visits_count      INT DEFAULT 0 CHECK (visits_count >= 0),
    last_visit_at     DATE,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(master_id, telegram_user_id)
);

CREATE INDEX idx_clients_master ON clients(master_id);
CREATE INDEX idx_clients_tg ON clients(telegram_user_id);


-- 2.8 ЗАПИСИ КЛИЕНТОВ
CREATE TABLE appointments (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id           UUID NOT NULL REFERENCES masters(id),
    client_id           UUID NOT NULL REFERENCES clients(id),
    service_id          UUID NOT NULL REFERENCES services(id),

    date                DATE NOT NULL,
    time_start          TIME NOT NULL,
    time_end            TIME NOT NULL,  -- вычисляется сервером: time_start + duration_min
    duration_min        INT NOT NULL CHECK (duration_min > 0),

    price               INT NOT NULL CHECK (price > 0),  -- зафиксирован на момент записи
    status              VARCHAR(20) NOT NULL DEFAULT 'confirmed'
                        CHECK (status IN ('confirmed', 'cancelled', 'completed', 'no_show')),
    cancellation_reason TEXT,
    client_notes        TEXT,

    notified_24h        BOOLEAN DEFAULT FALSE,
    notified_2h         BOOLEAN DEFAULT FALSE,

    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- КРИТИЧНО: исключает двойное бронирование на уровне БД.
-- Два клиента не могут записаться к одному мастеру на одно и то же время.
-- WHERE status='confirmed' означает: отменённые слоты снова становятся свободными.
CREATE UNIQUE INDEX idx_no_double_booking
ON appointments(master_id, date, time_start)
WHERE status = 'confirmed';

-- Быстрое получение расписания мастера на день
CREATE INDEX idx_apt_master_date ON appointments(master_id, date)
WHERE status = 'confirmed';

-- Быстрый экран "Мои записи" для клиента
CREATE INDEX idx_apt_client ON appointments(client_id, date);

CREATE TRIGGER trg_appointments_updated_at
BEFORE UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- 2.9 ИСТОРИЯ ПОДПИСОК / ПЛАТЕЖЕЙ
CREATE TABLE subscriptions (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id             UUID NOT NULL REFERENCES masters(id),
    plan                  VARCHAR(20) NOT NULL,
    amount                INT NOT NULL CHECK (amount > 0),
    currency              VARCHAR(10) DEFAULT 'RUB',
    starts_at             TIMESTAMPTZ NOT NULL,
    expires_at            TIMESTAMPTZ NOT NULL,
    -- UNIQUE защищает от повторной активации одного и того же платежа
    tg_payment_charge_id  TEXT UNIQUE,
    status                VARCHAR(20) DEFAULT 'active'
                          CHECK (status IN ('active', 'expired', 'refunded')),
    created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sub_master ON subscriptions(master_id, expires_at);


-- 2.10 ОЧЕРЕДЬ УВЕДОМЛЕНИЙ (для фонового воркера)
-- Воркер читает отсюда раз в минуту и отправляет сообщения через бот мастера.
CREATE TABLE notifications_queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    master_id       UUID NOT NULL REFERENCES masters(id),
    appointment_id  UUID NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
    type            VARCHAR(20) NOT NULL
                    CHECK (type IN ('confirmation', 'reminder_24h', 'reminder_2h', 'cancellation')),
    recipient       VARCHAR(10) NOT NULL
                    CHECK (recipient IN ('client', 'master')),
    chat_id         BIGINT NOT NULL,
    scheduled_at    TIMESTAMPTZ NOT NULL,   -- когда отправить
    sent_at         TIMESTAMPTZ,
    status          VARCHAR(10) DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sent', 'failed')),
    retry_count     SMALLINT DEFAULT 0,
    error           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Частичный индекс: воркер читает только pending-задачи.
-- Индекс маленький и быстрый — игнорирует уже отправленные.
CREATE INDEX idx_notif_pending ON notifications_queue(scheduled_at)
WHERE status = 'pending';


-- ─────────────────────────────────────────────────────────────
-- ЧАСТЬ 3: ROW LEVEL SECURITY (замки на таблицах)
-- ─────────────────────────────────────────────────────────────
-- RLS в Supabase — это как замки на картотечных ящиках.
-- После ALTER TABLE ... ENABLE ROW LEVEL SECURITY
-- никто кроме service_role (который использует FastAPI) не имеет доступа.
-- Весь доступ к данным идёт через FastAPI → он сам проверяет master_id.

ALTER TABLE themes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE masters             ENABLE ROW LEVEL SECURITY;
ALTER TABLE services            ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_photos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule            ENABLE ROW LEVEL SECURITY;
ALTER TABLE blocked_slots       ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications_queue ENABLE ROW LEVEL SECURITY;

-- Темы: публичное чтение (нужно для отображения превью в Mini App без авторизации)
CREATE POLICY "themes_public_read" ON themes
    FOR SELECT USING (true);
