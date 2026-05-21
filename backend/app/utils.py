import re
import secrets
import string

_TRANSLIT = {
    'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd',
    'е': 'e', 'ё': 'yo', 'ж': 'zh', 'з': 'z', 'и': 'i',
    'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n',
    'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't',
    'у': 'u', 'ф': 'f', 'х': 'kh', 'ц': 'ts', 'ч': 'ch',
    'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '',
    'э': 'e', 'ю': 'yu', 'я': 'ya',
}


def transliterate(text: str) -> str:
    result = []
    for char in text.lower():
        result.append(_TRANSLIT.get(char, char))
    return ''.join(result)


def generate_slug(name: str) -> str:
    slug = transliterate(name)
    slug = re.sub(r'[^a-z0-9]+', '-', slug)
    slug = slug.strip('-')
    return slug[:50] if slug else 'master'


def random_suffix(length: int = 4) -> str:
    chars = string.ascii_lowercase + string.digits
    return ''.join(secrets.choice(chars) for _ in range(length))


def format_price(price_min: int, price_max: int | None = None) -> str:
    def fmt(p: int) -> str:
        return f"{p:,}".replace(",", " ")

    if price_max and price_max > price_min:
        return f"{fmt(price_min)}–{fmt(price_max)} ₽"
    return f"от {fmt(price_min)} ₽"


def format_duration(minutes: int) -> str:
    hours, mins = divmod(minutes, 60)
    if hours and mins:
        return f"{hours} ч {mins} мин"
    if hours:
        return f"{hours} ч"
    return f"{mins} мин"
