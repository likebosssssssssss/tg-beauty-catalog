"""
Запусти этот файл в VS Code терминале:
  python test_db.py
"""
import asyncio
import sys
sys.path.insert(0, '.')

async def main():
    print("=== Тест подключения к базе данных ===\n")

    # 1. Импорты
    try:
        from app.config import settings
        from app.database import get_pool
        from app.auth import create_jwt, decode_jwt
        from app.encryption import encrypt_token, decrypt_token
        print("[OK] Все модули импортированы")
    except Exception as e:
        print(f"[FAIL] Ошибка импорта: {e}")
        return

    # 2. Подключение к БД
    try:
        pool = await get_pool()
        result = await pool.fetchval("SELECT 1")
        print(f"[OK] База данных подключена (SELECT 1 = {result})")
    except Exception as e:
        print(f"[FAIL] Ошибка подключения к БД: {e}")
        return

    # 3. Проверка таблиц
    try:
        tables = await pool.fetch(
            "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"
        )
        names = [r['tablename'] for r in tables]
        print(f"[OK] Таблицы в БД: {', '.join(names)}")
    except Exception as e:
        print(f"[FAIL] Ошибка чтения таблиц: {e}")
        return

    # 4. Тест JWT
    try:
        token = create_jwt("test-uuid", 123456)
        data = decode_jwt(token)
        print(f"[OK] JWT создан и декодирован (master_id={data['master_id']})")
    except Exception as e:
        print(f"[FAIL] Ошибка JWT: {e}")

    # 5. Тест шифрования
    try:
        original = "1234567890:ABCtest"
        encrypted = encrypt_token(original)
        decrypted = decrypt_token(encrypted)
        assert decrypted == original
        print(f"[OK] Шифрование токена работает")
    except Exception as e:
        print(f"[FAIL] Ошибка шифрования: {e}")

    # 6. Регистрация тестового мастера
    try:
        from app.utils import generate_slug, random_suffix

        slug = generate_slug("Kate Nails")
        existing = await pool.fetchrow(
            "SELECT id FROM masters WHERE telegram_user_id = $1", 999999999
        )
        if existing:
            print(f"[OK] Тестовый мастер уже есть в БД (id={existing['id']})")
        else:
            master = await pool.fetchrow(
                """
                INSERT INTO masters (telegram_user_id, slug, name, onboarding_step)
                VALUES ($1, $2, $3, 0)
                RETURNING id
                """,
                999999999, slug + "-test", "Kate Test"
            )
            print(f"[OK] Тестовый мастер создан (id={master['id']})")
    except Exception as e:
        print(f"[FAIL] Ошибка создания мастера: {e}")

    print("\n=== Все тесты завершены ===")

asyncio.run(main())
