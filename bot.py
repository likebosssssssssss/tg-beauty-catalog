# -*- coding: utf-8 -*-
"""
bot.py — Telegram-бот для @beauty_lusia_bot
Запуск: python bot.py   |   Остановка: Ctrl+C
"""
import urllib.request
import json
import time
import os

# Load .env
_env = os.path.join(os.path.dirname(__file__), '.env')
if os.path.exists(_env):
    with open(_env) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _k, _v = _line.split('=', 1)
                os.environ.setdefault(_k.strip(), _v.strip())

TOKEN    = os.environ.get('BOT_TOKEN', '')
if not TOKEN:
    raise RuntimeError('BOT_TOKEN not set. Add it to .env file.')
APP_URL  = "https://tg-app-phi-ten.vercel.app"
SEEN_FILE = "seen_users.json"


def api(method, payload=None):
    url  = f"https://api.telegram.org/bot{TOKEN}/{method}"
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload else None
    req  = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/json; charset=utf-8"} if data else {}
    )
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def load_seen():
    if os.path.exists(SEEN_FILE):
        try:
            with open(SEEN_FILE, "r") as f:
                return set(json.load(f))
        except Exception:
            pass
    return set()


def save_seen(seen):
    with open(SEEN_FILE, "w") as f:
        json.dump(list(seen), f)


def send_welcome(chat_id, first_name, is_new):
    name = first_name or "друг"

    # Приветствие — всегда
    api("sendMessage", {
        "chat_id": chat_id,
        "text": (
            f"Привет, {name}! 👋\n\n"
            "Я — бот бьюти-мастера. Здесь можно:\n\n"
            "💅 Посмотреть услуги и цены\n"
            "📷 Портфолио работ\n"
            "📅 Записаться онлайн\n\n"
            "Нажми «Каталог» внизу — откроется приложение 👇"
        ),
        "reply_markup": {
            "inline_keyboard": [[
                {"text": "📋 Открыть каталог", "web_app": {"url": APP_URL}}
            ]]
        }
    })

    # Промокод — только новым
    if is_new:
        api("sendMessage", {
            "chat_id": chat_id,
            "text": (
                "🎁 Ваш промокод: BEAUTY15\n\n"
                "Скидка 15% на первую запись!\n"
                "Просто назовите промокод при записи.\n\n"
                "Нажми «Каталог» внизу, чтобы выбрать услугу 👇"
            ),
            "reply_markup": {
                "inline_keyboard": [[
                    {"text": "💅 Выбрать услугу", "web_app": {"url": APP_URL}}
                ]]
            }
        })


seen_users = load_seen()
offset = 0
print("Bot started (@beauty_lusia_bot). Press Ctrl+C to stop.")

while True:
    try:
        result = api("getUpdates", {"offset": offset, "timeout": 30})
        for update in result.get("result", []):
            offset = update["update_id"] + 1
            msg        = update.get("message", {})
            text       = msg.get("text", "")
            chat_id    = msg.get("chat", {}).get("id")
            first_name = msg.get("from", {}).get("first_name", "")
            user_id    = msg.get("from", {}).get("id")

            if text.startswith("/start") or text.startswith("/help"):
                is_new = user_id not in seen_users
                print(f"-> {text} from {first_name} (new={is_new})")
                send_welcome(chat_id, first_name, is_new)
                if is_new:
                    seen_users.add(user_id)
                    save_seen(seen_users)

    except KeyboardInterrupt:
        print("\nBot stopped.")
        break
    except Exception as e:
        print(f"Error: {e}. Retry in 5s...")
        time.sleep(5)
