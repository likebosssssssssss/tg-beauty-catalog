from cryptography.fernet import Fernet
from app.config import settings


def _fernet() -> Fernet:
    return Fernet(settings.bot_encryption_key.encode())


def encrypt_token(token: str) -> str:
    """Шифрует токен бота перед сохранением в БД."""
    return _fernet().encrypt(token.encode()).decode()


def decrypt_token(encrypted: str) -> str:
    """Расшифровывает токен бота для использования в памяти."""
    return _fernet().decrypt(encrypted.encode()).decode()
