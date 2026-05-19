/* ================================================
   data.js — Данные мастера, услуги, слоты
   Меняй здесь: имя, услуги, цены, описания
   ================================================ */

/* ─── Мастер ─── */
const MASTER = {
    name:        'Люся',
    specialty:   'Nail-мастер',
    city:        'Москва',
    metro:       'м. Арбатская',
    rating:      4.9,
    reviews:     127,
    experience:  '7 лет',
    status:      'active',   // 'active' | 'busy'
    statusText:  'Принимает записи',
    busyUntil:   '',         // если status='busy', например: 'до пятницы'
    avatarLetter: 'Л',
    botUsername:  'beauty_lusia_bot',
};

/* ─── Услуги ─── */
const SERVICES = [
    {
        id:           'gel-manicure',
        category:     'manicure',
        categoryName: 'Маникюр',
        name:         'Маникюр с гель-лаком',
        description:  'Идеальное покрытие, которое держится 2–3 недели без сколов. Включает обработку кутикулы, коррекцию формы и нанесение качественного гель-лака Shell.',
        price:        2500,
        priceMax:     3500,
        priceText:    'от 2 500 ₽',
        duration:     90,
        durationText: '1 ч 30 мин',
        emoji:        '💅',
        /* CSS-градиент для фото-заглушки */
        gradient:     'linear-gradient(135deg, #FF9A9E 0%, #FECFEF 55%, #C6ACEE 100%)',
        /* Несколько "фото" — каждое свой градиент + эмодзи */
        photos: [
            { gradient: 'linear-gradient(135deg, #FF9A9E 0%, #FECFEF 100%)',  emoji: '💅' },
            { gradient: 'linear-gradient(135deg, #C6ACEE 0%, #FECFEF 100%)', emoji: '✨' },
            { gradient: 'linear-gradient(135deg, #FECFEF 0%, #FF9A9E 100%)', emoji: '💎' },
        ],
        includes: [
            'Снятие старого покрытия',
            'Обработка кутикулы',
            'Коррекция и формирование',
            'Нанесение гель-лака',
            'Финишное топ-покрытие',
        ],
    },
    {
        id:           'classic-manicure',
        category:     'manicure',
        categoryName: 'Маникюр',
        name:         'Классический маникюр',
        description:  'Базовый уход за ногтями: обработка кутикулы, коррекция формы, полировка. Без покрытия или с обычным лаком по желанию.',
        price:        1200,
        priceMax:     null,
        priceText:    '1 200 ₽',
        duration:     60,
        durationText: '1 час',
        emoji:        '🌸',
        gradient:     'linear-gradient(135deg, #FFAFBD 0%, #FFC3A0 100%)',
        photos: [
            { gradient: 'linear-gradient(135deg, #FFAFBD 0%, #FFC3A0 100%)', emoji: '🌸' },
            { gradient: 'linear-gradient(135deg, #FFC3A0 0%, #FFAFBD 100%)', emoji: '✨' },
        ],
        includes: [
            'Обработка кутикулы',
            'Коррекция формы',
            'Полировка ногтевой пластины',
            'Питательное масло для кутикулы',
            'Лак (опционально)',
        ],
    },
    {
        id:           'gel-pedicure',
        category:     'pedicure',
        categoryName: 'Педикюр',
        name:         'Педикюр с гель-лаком',
        description:  'Полный уход за стопами: расслабляющая ванночка, аппаратная обработка, гель-лак. Ноги мягкие и красивые на 3–4 недели.',
        price:        3200,
        priceMax:     4000,
        priceText:    'от 3 200 ₽',
        duration:     120,
        durationText: '2 часа',
        emoji:        '🦋',
        gradient:     'linear-gradient(135deg, #A1C4FD 0%, #C2E9FB 100%)',
        photos: [
            { gradient: 'linear-gradient(135deg, #A1C4FD 0%, #C2E9FB 100%)', emoji: '🦋' },
            { gradient: 'linear-gradient(135deg, #C2E9FB 0%, #A1C4FD 100%)', emoji: '💙' },
        ],
        includes: [
            'Расслабляющая ванночка',
            'Аппаратный педикюр',
            'Обработка кутикулы',
            'Питание и увлажнение стоп',
            'Нанесение гель-лака',
        ],
    },
    {
        id:           'classic-pedicure',
        category:     'pedicure',
        categoryName: 'Педикюр',
        name:         'Классический педикюр',
        description:  'Базовый педикюр без покрытия. Идеально для регулярного ухода: ванночка, обработка стоп и кутикулы, полировка.',
        price:        2000,
        priceMax:     null,
        priceText:    '2 000 ₽',
        duration:     90,
        durationText: '1 ч 30 мин',
        emoji:        '🌊',
        gradient:     'linear-gradient(135deg, #D4FC79 0%, #96E6A1 100%)',
        photos: [
            { gradient: 'linear-gradient(135deg, #D4FC79 0%, #96E6A1 100%)', emoji: '🌊' },
        ],
        includes: [
            'Расслабляющая ванночка',
            'Обработка стоп',
            'Обработка кутикулы',
            'Полировка',
        ],
    },
    {
        id:           'combo',
        category:     'combo',
        categoryName: 'Комбо',
        name:         'Маникюр + Педикюр',
        description:  'Полный уход в одно посещение! Маникюр с гель-лаком и педикюр с гель-лаком — всё сразу по выгодной комбинированной цене.',
        price:        5000,
        priceMax:     6500,
        priceText:    'от 5 000 ₽',
        duration:     210,
        durationText: '3 ч 30 мин',
        emoji:        '✨',
        gradient:     'linear-gradient(135deg, #FDDB92 0%, #D1FDFF 100%)',
        photos: [
            { gradient: 'linear-gradient(135deg, #FDDB92 0%, #D1FDFF 100%)', emoji: '✨' },
            { gradient: 'linear-gradient(135deg, #D1FDFF 0%, #FDDB92 100%)', emoji: '💆' },
        ],
        includes: [
            'Маникюр с гель-лаком',
            'Педикюр с гель-лаком',
            'Скидка 15% от раздельной цены',
            'Чай или кофе в подарок',
        ],
    },
    {
        id:           'removal',
        category:     'removal',
        categoryName: 'Снятие',
        name:         'Снятие покрытия',
        description:  'Бережное снятие гель-лака, акрила или наращенных ногтей. Без повреждения натуральной пластины — используем фольгу и профессиональные средства.',
        price:        600,
        priceMax:     null,
        priceText:    '600 ₽',
        duration:     30,
        durationText: '30 минут',
        emoji:        '🧴',
        gradient:     'linear-gradient(135deg, #D3CCE3 0%, #E9E4F0 100%)',
        photos: [
            { gradient: 'linear-gradient(135deg, #D3CCE3 0%, #E9E4F0 100%)', emoji: '🧴' },
        ],
        includes: [
            'Снятие гель-лака или акрила',
            'Уходовое масло для ногтей',
            'Базовая шлифовка пластины',
        ],
    },
    {
        id:           'nail-design',
        category:     'design',
        categoryName: 'Дизайн',
        name:         'Дизайн ногтей',
        description:  'Уникальные рисунки, стразы, фольга, глиттер, омбре — любой дизайн по вашему фото или референсу. Цена зависит от сложности.',
        price:        150,
        priceMax:     600,
        priceText:    'от 150 ₽/ноготь',
        duration:     30,
        durationText: 'от 30 мин',
        emoji:        '🎨',
        gradient:     'linear-gradient(135deg, #F6D365 0%, #FDA085 100%)',
        photos: [
            { gradient: 'linear-gradient(135deg, #F6D365 0%, #FDA085 100%)', emoji: '🎨' },
            { gradient: 'linear-gradient(135deg, #FDA085 0%, #C6ACEE 100%)', emoji: '💎' },
            { gradient: 'linear-gradient(135deg, #C6ACEE 0%, #F6D365 100%)', emoji: '⭐' },
        ],
        includes: [
            'Рисунки от руки гель-красками',
            'Стразы и пигменты',
            'Фольга и голография',
            'Градиент (омбре)',
            'Любой дизайн по вашему фото',
        ],
    },
];

/* ─── Локализация ─── */
const MONTHS_RU = [
    'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

const MONTHS_SHORT_RU = [
    'янв', 'фев', 'мар', 'апр', 'май', 'июн',
    'июл', 'авг', 'сен', 'окт', 'ноя', 'дек',
];

const DAYS_SHORT_RU = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const DAYS_FULL_RU = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

/* ─── Генерация 14 дней для выбора ─── */
function generateDates() {
    const dates = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 0; i < 14; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() + i);
        dates.push({
            date:     d,
            dateStr:  formatDateISO(d),
            dayShort: DAYS_SHORT_RU[d.getDay()],
            num:      d.getDate(),
            month:    MONTHS_SHORT_RU[d.getMonth()],
            isToday:  i === 0,
        });
    }
    return dates;
}

/* ─── Генерация слотов для выбранной даты ─── */
function generateSlots(dateStr) {
    const date       = new Date(dateStr);
    const dayOfWeek  = date.getDay();           // 0=вс, 6=сб
    const isWeekend  = dayOfWeek === 0 || dayOfWeek === 6;

    /* Набор всех возможных слотов */
    const allSlots = isWeekend
        ? ['11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30']
        : ['10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30',
           '14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00','18:30'];

    /* Псевдослучайные занятые слоты (детерминированы по дате) */
    const seed = date.getDate() * 7 + date.getMonth() * 31;
    const occupiedCount = isWeekend ? 3 : 6;
    const occupied = new Set();

    for (let i = 0; i < occupiedCount; i++) {
        /* Простой LCG для воспроизводимости */
        const idx = ((seed * (i + 7)) * 1103515245 + 12345) & 0x7fffffff;
        occupied.add(idx % allSlots.length);
    }

    return allSlots.map((time, i) => ({
        time,
        available: !occupied.has(i),
        period:    timeToPeriod(time),
    }));
}

/* ─── Вспомогательные функции ─── */
function timeToPeriod(time) {
    const h = parseInt(time.split(':')[0], 10);
    if (h < 12) return 'morning';
    if (h < 17) return 'day';
    return 'evening';
}

function formatDateISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/* Читаемая дата: "среда, 21 мая в 14:00" */
function formatDateFull(dateStr, timeStr) {
    const date    = new Date(dateStr);
    const dayName = DAYS_FULL_RU[date.getDay()];
    const num     = date.getDate();
    const month   = MONTHS_RU[date.getMonth()];
    const cap     = dayName.charAt(0).toUpperCase() + dayName.slice(1);
    return timeStr
        ? `${cap}, ${num} ${month} в ${timeStr}`
        : `${cap}, ${num} ${month}`;
}

/* "21 мая" */
function formatDateShort(dateStr) {
    const date  = new Date(dateStr);
    return `${date.getDate()} ${MONTHS_RU[date.getMonth()]}`;
}

/* ─── Хранилище записей (localStorage для MVP) ─── */
const APT_KEY = 'beauty_appointments';

function getAppointments() {
    try {
        return JSON.parse(localStorage.getItem(APT_KEY) || '[]');
    } catch { return []; }
}

function saveAppointment(apt) {
    const list = getAppointments();
    list.unshift(apt);
    localStorage.setItem(APT_KEY, JSON.stringify(list));
}

function cancelAppointmentById(id) {
    const list = getAppointments().map(a =>
        a.id === id ? { ...a, status: 'cancelled' } : a
    );
    localStorage.setItem(APT_KEY, JSON.stringify(list));
}

function generateId() {
    return 'apt-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
}

/* Сервис по id */
function getServiceById(id) {
    return SERVICES.find(s => s.id === id) || null;
}
