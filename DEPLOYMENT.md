# Деплой Beauty SaaS — пошаговая инструкция

> Для кого: новичок, который первый раз разворачивает этот проект.  
> Время: ~2 часа от нуля до рабочего API.

---

## Что из чего состоит

```
Telegram-пользователь
        │
        ▼
   [Telegram API]
        │
        ├──► platform_bot.py  ←── регистрирует мастеров
        │
        └──► nginx (порт 443)
                  │
                  └──► FastAPI (порт 8000)
                            │
                            └──► Supabase (PostgreSQL)

   worker.py ──────────────────► Supabase + Telegram API
                                 (фоновые уведомления)

   tg-app/ ─────────────────────► Vercel (статический фронтенд)
```

**Три сервиса на VPS:**
- `beauty-api` — основной API (FastAPI)
- `beauty-bot` — платформенный бот (регистрация мастеров)
- `beauty-worker` — воркер уведомлений

---

## Шаг 0. Что нужно создать заранее

### 0.1 Supabase (база данных)

1. Зарегистрируйся на [supabase.com](https://supabase.com) — бесплатно
2. Создай новый проект (New Project)
3. Запомни пароль базы данных — он понадобится
4. Зайди: Project Settings → Database → Connection string → URI
5. Скопируй строку вида:
   ```
   postgresql://postgres:ВАШ_ПАРОЛЬ@db.XXXXX.supabase.co:5432/postgres
   ```
6. Зайди в SQL Editor и выполни схему базы (файл `backend/schema.sql` — если его нет, запроси у разработчика)

### 0.2 Telegram-боты

Создай через [@BotFather](https://t.me/BotFather):

**Бот платформы** (один на всю SaaS-платформу):
```
/newbot
Название: Beauty Platform
Username: @yoursaas_bot
```
Скопируй токен вида `7xxx:AAFyyy` — это `PLATFORM_BOT_TOKEN`.

**Настрой Mini App для платформенного бота:**
```
/newapp → выбери @yoursaas_bot → укажи URL фронтенда (Vercel)
```

### 0.3 Верcel (фронтенд)

1. Зарегистрируйся на [vercel.com](https://vercel.com)
2. New Project → Import Git Repository → выбери репозиторий
3. Root Directory: `tg-app`
4. Deploy
5. Скопируй URL вида `https://your-project.vercel.app` — это `APP_BASE_URL`

---

## Шаг 1. VPS — первый запуск

Провайдер в проекте: Beget (beget.com). Минимальная конфигурация: **1 ядро / 1 ГБ RAM / Ubuntu 24.04**.

### 1.1 Подключись по SSH

**Windows (PowerShell):**
```powershell
ssh root@ВАШ_IP
```
Введи пароль root. Готово — ты на сервере.

**Если SSH не установлен в Windows:**
Скачай [PuTTY](https://putty.org) или используй Windows Terminal.

### 1.2 Обновление системы

```bash
apt update && apt upgrade -y
```
> Если видишь ошибку "Could not get lock" — подожди 2 минуты и повтори. Ubuntu обновляется сам при первом запуске.

### 1.3 Установка Python

```bash
apt install -y python3 python3-pip python3-venv nginx git curl
python3 --version   # должно быть 3.10+
```

---

## Шаг 2. Загрузка кода на сервер

### Вариант A: через Git (рекомендуется)

```bash
cd /opt
git clone https://github.com/ВАШ_АККАУНТ/tg-beauty-catalog.git beauty-api
cd beauty-api/backend
```

### Вариант B: через scp (с локального компьютера)

В PowerShell на твоём компьютере:
```powershell
scp -r C:\Users\Пользователь\Documents\Project\tg-beauty-catalog\backend root@ВАШ_IP:/opt/beauty-api
```

---

## Шаг 3. Настройка Python-окружения

```bash
cd /opt/beauty-api
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Проверка:
```bash
python -c "import fastapi, asyncpg, jwt; print('OK')"
```

---

## Шаг 4. Файл переменных окружения (.env)

```bash
nano /opt/beauty-api/.env
```

Вставь и заполни (Ctrl+Shift+V в терминале):

```env
# База данных
DATABASE_URL=postgresql://postgres:ПАРОЛЬ@db.XXXXX.supabase.co:5432/postgres

# Telegram — платформенный бот
PLATFORM_BOT_TOKEN=7xxx:AAFyyy

# Секрет для /internal/ эндпоинтов
INTERNAL_API_SECRET=СГЕНЕРИРУЙ_НИЖЕ

# Ключ шифрования токенов ботов мастеров
BOT_ENCRYPTION_KEY=СГЕНЕРИРУЙ_НИЖЕ

# JWT
JWT_SECRET=СГЕНЕРИРУЙ_НИЖЕ
JWT_ALGORITHM=HS256
JWT_EXPIRE_HOURS=24

# URL-адреса (заполни после настройки SSL)
APP_BASE_URL=https://your-project.vercel.app
API_BASE_URL=https://ВАШ_ДОМЕН_ИЛИ_IP
```

Сохрани: Ctrl+X → Y → Enter.

**Как сгенерировать секреты** (выполни на сервере):
```bash
source /opt/beauty-api/venv/bin/activate
python3 -c "import secrets; print(secrets.token_urlsafe(48))"   # для INTERNAL_API_SECRET и JWT_SECRET
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"  # для BOT_ENCRYPTION_KEY
```
Каждую команду запускай отдельно — получишь три разных ключа.

---

## Шаг 5. Systemd-сервисы (автозапуск)

### 5.1 Основной API (FastAPI)

```bash
nano /etc/systemd/system/beauty-api.service
```

```ini
[Unit]
Description=Beauty SaaS API
After=network.target

[Service]
User=root
WorkingDirectory=/opt/beauty-api
ExecStart=/opt/beauty-api/venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 5.2 Платформенный бот

```bash
nano /etc/systemd/system/beauty-bot.service
```

```ini
[Unit]
Description=Beauty Platform Bot
After=network.target beauty-api.service

[Service]
User=root
WorkingDirectory=/opt/beauty-api
ExecStart=/opt/beauty-api/venv/bin/python platform_bot.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 5.3 Воркер уведомлений

```bash
nano /etc/systemd/system/beauty-worker.service
```

```ini
[Unit]
Description=Beauty Notifications Worker
After=network.target beauty-api.service

[Service]
User=root
WorkingDirectory=/opt/beauty-api
ExecStart=/opt/beauty-api/venv/bin/python worker.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 5.4 Запуск всех сервисов

```bash
systemctl daemon-reload
systemctl enable beauty-api beauty-bot beauty-worker
systemctl start beauty-api beauty-bot beauty-worker
```

Проверка статуса:
```bash
systemctl status beauty-api beauty-bot beauty-worker
```
Все три должны показывать `active (running)`.

---

## Шаг 6. Nginx — обратный прокси

```bash
nano /etc/nginx/sites-available/beauty-api
```

```nginx
server {
    listen 80;
    server_name ВАШ_IP_ИЛИ_ДОМЕН;

    # Блокируем внутренние эндпоинты снаружи
    location /internal/ {
        return 403;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/beauty-api /etc/nginx/sites-enabled/
nginx -t          # проверка конфига — должно быть "test is successful"
systemctl restart nginx
```

**Проверка:**
```bash
curl http://ВАШ_IP/health
# ожидаемый ответ: {"status":"ok","version":"1.0.0"}
```

---

## Шаг 7. SSL/HTTPS (обязательно для Telegram)

Telegram требует HTTPS для webhook-ов. Без этого шага боты мастеров не будут получать сообщения.

> Нужен домен (купи на любом регистраторе, можно за 100-200 руб/год).  
> Если домена нет — используй IP напрямую (webhook не будет работать, только polling).

### 7.1 Привяжи домен к IP

В панели регистратора домена создай A-запись:
```
@    →    ВАШ_IP
```
Подожди 5-30 минут пока DNS обновится.

### 7.2 Установи Certbot (Let's Encrypt)

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d ваш-домен.ru
```

Введи email, согласись с условиями. Certbot сам обновит конфиг nginx.

### 7.3 Обнови .env

```bash
nano /opt/beauty-api/.env
```
Измени:
```env
API_BASE_URL=https://ваш-домен.ru
```

```bash
systemctl restart beauty-api beauty-bot beauty-worker
```

**Проверка:**
```bash
curl https://ваш-домен.ru/health
# ожидаемый ответ: {"status":"ok","version":"1.0.0"}
```

---

## Шаг 8. Обновление кода (когда вносишь изменения)

```bash
cd /opt/beauty-api
git pull                                # скачать изменения
source venv/bin/activate
pip install -r requirements.txt         # если добавились новые зависимости
systemctl restart beauty-api beauty-bot beauty-worker
```

---

## Проверочный список

После деплоя убедись что всё работает:

| Что проверяем | Команда | Ожидаемый результат |
|---|---|---|
| API работает | `curl http://IP/health` | `{"status":"ok"}` |
| JWT защита | `curl http://IP/api/onboarding/status` | `{"detail":"Missing or invalid..."}` |
| Internal закрыт | `curl http://IP/internal/onboarding/register` | HTTP 403 |
| API сервис | `systemctl status beauty-api` | `active (running)` |
| Бот сервис | `systemctl status beauty-bot` | `active (running)` |
| Воркер | `systemctl status beauty-worker` | `active (running)` |
| HTTPS | `curl https://домен/health` | `{"status":"ok"}` |

---

## Логи — что смотреть если что-то сломалось

```bash
# Логи API
journalctl -u beauty-api -f

# Логи бота
journalctl -u beauty-bot -f

# Логи nginx
tail -f /var/log/nginx/error.log

# Последние 100 строк любого сервиса
journalctl -u beauty-api -n 100
```

---

## Частые проблемы

**"Could not get lock /var/lib/dpkg/lock"**
```bash
# Ubuntu сам обновляется. Подожди 2-5 минут и повтори apt install.
```

**"Connection refused" на порту 8000**
```bash
systemctl status beauty-api   # смотри ошибку
journalctl -u beauty-api -n 50
```

**"no pg_hba.conf entry" или ошибка SSL при подключении к Supabase**
```bash
# Проверь DATABASE_URL в .env — нужен точный формат:
# postgresql://postgres:ПАРОЛЬ@db.XXXXX.supabase.co:5432/postgres
```

**Nginx выдаёт 502 Bad Gateway**
```bash
# API не запущен или упал:
systemctl restart beauty-api
```

**Certbot ошибка "could not be found"**
```bash
# DNS ещё не обновился. Подожди 30 минут и повтори certbot.
```

---

## Текущая конфигурация проекта

| Компонент | Где | Адрес |
|---|---|---|
| Backend API | Beget VPS | http://89.169.38.23 |
| Frontend | Vercel | https://tg-app-phi-ten.vercel.app |
| База данных | Supabase | db.chueisfmgliyxxypdqyo.supabase.co |
| API документация | VPS | http://89.169.38.23/docs |
