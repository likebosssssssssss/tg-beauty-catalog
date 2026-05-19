# CLAUDE.md — Документация проекта

> Telegram Mini App: каталог услуг nail-мастера Люси

---

## Структура файлов

```
tg-app/
├── index.html          ← Точка входа. Все экраны как <div class="screen">
├── css/
│   └── style.css       ← Вся дизайн-система: переменные, компоненты, анимации
└── js/
    ├── data.js         ← Данные мастера, услуг; генерация дат и слотов
    ├── tg.js           ← Обёртка Telegram WebApp SDK (MainButton, BackButton, Haptic…)
    ├── router.js       ← Навигация между экранами (show/hide + анимации)
    └── app.js          ← Логика всех экранов, привязка событий, рендер

CLAUDE.md               ← Эта документация
research.md             ← Анализ конкурентов и UI-паттернов
brief.md                ← Требования и спецификация MVP
```

---

## Экраны и навигация

| ID экрана     | Описание                         | Файл данных   |
|---------------|----------------------------------|---------------|
| `home`        | Главная: профиль + каталог услуг | `data.js`     |
| `service`     | Карточка услуги: галерея + инфо  | `app.js`      |
| `booking`     | Выбор даты и времени             | `app.js`      |
| `confirm`     | Итог записи + подтверждение      | `app.js`      |
| `success`     | Запись оформлена (успех)         | `app.js`      |
| `appointments`| Мои записи: предстоящие + история| `app.js`      |
| `cancel`      | Подтверждение отмены             | `app.js`      |

### Флоу записи:
```
[home] → [service] → [booking] → [confirm] → [success]
                                                  ↓
                                           [appointments]
```

### BackButton поведение:
| Экран         | Кнопка «Назад»              |
|---------------|-----------------------------|
| home          | Не перехватывается (закрыть)|
| service       | → home                      |
| booking       | → service                   |
| confirm       | → booking                   |
| success       | → home                      |
| appointments  | Не перехватывается (закрыть)|
| cancel        | → appointments              |

---

## Где менять данные

### Имя и информация о мастере
`js/data.js`, объект `MASTER`:
```js
const MASTER = {
    name:       'Люся',          // имя
    specialty:  'Nail-мастер',   // специализация
    city:       'Москва',
    metro:      'м. Арбатская',
    rating:     4.9,
    reviews:    127,
    status:     'active',        // 'active' | 'busy'
    statusText: 'Принимает записи',
};
```

### Услуги и цены
`js/data.js`, массив `SERVICES`. Каждый объект:
```js
{
    id:           'gel-manicure',    // уникальный ключ
    category:     'manicure',        // фильтр: manicure | pedicure | combo | removal | design
    categoryName: 'Маникюр',         // отображаемое имя категории
    name:         'Маникюр с гель-лаком',
    description:  'Описание...',
    price:        2500,              // минимальная цена (число)
    priceText:    'от 2 500 ₽',     // отображаемая цена
    duration:     90,               // длительность в минутах
    durationText: '1 ч 30 мин',     // отображаемая длительность
    emoji:        '💅',
    gradient:     'linear-gradient(...)',  // цвет фото-заглушки
    photos: [                        // массив "фотографий" (градиент + эмодзи)
        { gradient: '...', emoji: '💅' },
    ],
    includes: ['Снятие покрытия', ...],   // что включено
}
```

### Категории-фильтры (чипы)
`index.html`, блок `#categories-scroll`:
```html
<button class="chip" data-category="manicure">Маникюр</button>
```
Значение `data-category` должно совпадать с `category` у услуги.

### Слоты времени
`js/data.js`, функция `generateSlots(dateStr)`:
- По будням: 10:00–18:30 (18 слотов)
- По выходным: 11:00–15:30 (10 слотов)
- Часть слотов псевдослучайно помечается занятыми (детерминировано по дате)

Для реального расписания: замени функцию на API-запрос.

---

## Telegram API, задействованный в приложении

| API                         | Где используется        | Файл    |
|-----------------------------|-------------------------|---------|
| `expand()`                  | Старт → полный экран    | tg.js   |
| `themeParams`               | Цвета темы → CSS vars   | tg.js   |
| `initDataUnsafe.user`       | Имя клиента в итоге     | app.js  |
| `BackButton`                | Навигация назад         | tg.js   |
| `MainButton`                | CTA на каждом шаге      | tg.js   |
| `HapticFeedback`            | Выбор слота / успех     | tg.js   |
| `CloudStorage`              | Черновик записи         | tg.js   |
| `enableClosingConfirmation` | Шаги 3–5 флоу           | app.js  |

---

## Хранилище данных (MVP без бэкенда)

- **Записи клиента** → `localStorage` (ключ `beauty_appointments`)
- **Черновик флоу** → `CloudStorage` (ключ `booking_draft`) + fallback в `sessionStorage`
- **Тема** → не хранится, берётся из `themeParams` при каждом запуске

---

## Дизайн-система (CSS-переменные)

Все цвета — через CSS-переменные, **не хардкодить hex**:

| Переменная             | Применение              |
|------------------------|-------------------------|
| `--tg-bg`              | Фон страницы            |
| `--tg-secondary-bg`    | Фон карточек            |
| `--tg-text`            | Основной текст          |
| `--tg-hint`            | Серый/подсказка         |
| `--accent`             | Кнопки, цена, акцент    |
| `--accent-light`       | Светлый акцент (фон чипа)|
| `--success`            | Зелёный (чекмарк)       |
| `--danger`             | Красный (отмена)        |

Тёмная тема применяется классом `body.tg-dark` (ставится через `tg.js`).

---

## Запуск и тестирование

### В браузере (разработка):
1. Откройте `tg-app/index.html` напрямую или через локальный HTTP-сервер
2. Telegram-кнопки (`MainButton`, `BackButton`) скрыты — вместо них кнопки `browser-only`
3. Данные пользователя — заглушка "Гость"

### В Telegram:
1. Разверните на HTTPS-хостинге (обязательно для TMA)
2. Создайте бота через @BotFather, настройте Menu Button → Web App URL
3. Telegram автоматически передаёт `themeParams`, `initData`, управляет кнопками

### Тестирование на мобильном:
- iOS Telegram WebView: проверить свайп галереи, MainButton над клавиатурой
- Android Telegram WebView: поведение BackButton, safe-area-inset

---

## Что добавить в v2

- [ ] Бэкенд API (Node.js / FastAPI): реальные слоты, записи, профиль мастера
- [ ] Верификация `initData` через HMAC-SHA256 на сервере
- [ ] Push-напоминания за 24 ч и 2 ч (через Telegram Bot)
- [ ] Портфолио / отдельная галерея работ
- [ ] Отзывы клиентов
- [ ] Онлайн-оплата через Telegram Payments
- [ ] Выбор дизайна / загрузка референса при записи
- [ ] Аналитика для мастера (дэшборд)
