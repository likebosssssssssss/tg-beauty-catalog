/* ================================================
   app.js — Главная логика приложения
   Инициализация, логика каждого экрана, навигация
   ================================================ */

/* ─── Глобальное состояние флоу записи ─── */
const State = {
    /* Выбранная услуга (объект из SERVICES) */
    service:    null,
    /* Выбранная дата (ISO строка 'YYYY-MM-DD') */
    date:       null,
    /* Выбранное время (строка '14:00') */
    time:       null,
    /* Запись которую отменяем */
    cancelingId: null,
    /* Данные пользователя из Telegram */
    user:       null,
};

/* ─── Точка входа ─── */
document.addEventListener('DOMContentLoaded', function () {
    /* 1. Инициализация Telegram SDK */
    TG.init();

    /* 2. Получаем данные пользователя */
    State.user = TG.getUser();

    /* 3. Инициализация роутера */
    Router.init();

    /* 4. Навешиваем обработчики */
    bindEvents();

    /* 5. Рендерим главный экран */
    renderHome();

    /* 6. Онбординг или главный экран */
    if (!localStorage.getItem('beauty_onboarding_shown')) {
        renderOnboarding();
        Router.replace('onboarding');
    }

    /* 7. Убираем оверлей загрузки */
    setTimeout(() => {
        document.getElementById('loading-overlay').classList.add('hidden');
        /* 8. Оффер — только если онбординг уже был показан ранее */
        if (localStorage.getItem('beauty_onboarding_shown')) {
            showOfferModal();
        }
    }, 600);
});

/* ─── Навешивание событий ─── */
function bindEvents() {
    /* ── Онбординг: кнопка «Начать» ── */
    document.getElementById('onboarding-start').addEventListener('click', finishOnboarding);

    /* ── Главная: категории ── */
    document.getElementById('categories-scroll').addEventListener('click', function (e) {
        const chip = e.target.closest('.chip');
        if (!chip) return;
        document.querySelectorAll('#categories-scroll .chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        renderServicesList(chip.dataset.category);
    });

    /* ── Нижняя навигация (оба экрана с nav) ── */
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const nav = this.dataset.nav;
            if (nav === 'home') goHome();
            if (nav === 'appointments') goAppointments();
        });
    });

    /* ── Карточка услуги: назад ── */
    document.getElementById('service-back').addEventListener('click', goBack);

    /* ── Карточка услуги: кнопка «Записаться» (браузер) ── */
    document.getElementById('service-book-btn').addEventListener('click', function () {
        goToBooking();
    });

    /* ── Бронирование: назад ── */
    document.getElementById('booking-back').addEventListener('click', goBack);

    /* ── Бронирование: кнопка «Далее» (браузер) ── */
    document.getElementById('booking-next-btn').addEventListener('click', function () {
        if (!State.date || !State.time) return;
        goToConfirm();
    });

    /* ── Подтверждение: назад ── */
    document.getElementById('confirm-back').addEventListener('click', goBack);

    /* ── Подтверждение: кнопка «Подтвердить» (браузер) ── */
    document.getElementById('confirm-btn').addEventListener('click', function () {
        confirmBooking();
    });

    /* ── Успех: кнопки ── */
    document.getElementById('success-to-appointments').addEventListener('click', goAppointments);
    document.getElementById('success-to-home').addEventListener('click', goHome);

    /* ── Отмена: назад ── */
    document.getElementById('cancel-back').addEventListener('click', goBack);

    /* ── Отмена: кнопки ── */
    document.getElementById('cancel-confirm-btn').addEventListener('click', doCancelAppointment);
    document.getElementById('cancel-keep-btn').addEventListener('click', goBack);

    /* ── Поделиться ── */
    document.getElementById('share-btn').addEventListener('click', shareApp);
}

/* ─── ЭКРАН 0: Онбординг ─── */
function renderOnboarding() {
    const user = State.user;
    const greeting = document.getElementById('onboarding-greeting');
    if (user && user.first_name) {
        greeting.textContent = `Привет, ${user.first_name}! 👋`;
    } else {
        greeting.textContent = 'Привет! 👋';
    }

    TG.BackButton.hide();
    TG.MainButton.hide();
}

function finishOnboarding() {
    localStorage.setItem('beauty_onboarding_shown', '1');

    /* Явно убираем онбординг и показываем home — надёжнее Router.go */
    const onbEl  = document.getElementById('screen-onboarding');
    const homeEl = document.getElementById('screen-home');
    if (onbEl)  { onbEl.classList.add('slide-left'); onbEl.classList.remove('active'); }
    if (homeEl) { homeEl.scrollTop = 0; homeEl.classList.remove('slide-left'); homeEl.classList.add('active'); }

    /* Синхронизируем роутер */
    Router.go('home');

    setNavActive('home-nav', 'home');
    TG.Haptic.light();
    setTimeout(() => showOfferModal(), 800);
}

/* ─── ЭКРАН 1: Главная ─── */
function renderHome() {
    renderServicesList('all');
    /* Активируем нижнюю навигацию */
    setNavActive('home-nav', 'home');
}

function renderServicesList(category) {
    const list = document.getElementById('services-list');

    /* Фильтруем услуги */
    const filtered = category === 'all'
        ? SERVICES
        : SERVICES.filter(s => s.category === category);

    /* Анимация появления */
    list.style.opacity = '0';
    setTimeout(() => {
        list.innerHTML = filtered.map(serviceCardHtml).join('');

        /* Навешиваем события на карточки */
        list.querySelectorAll('.service-card').forEach(card => {
            const id = card.dataset.id;
            /* Тап на всю карточку → детали услуги */
            card.addEventListener('click', function (e) {
                if (e.target.closest('.btn-book')) return;
                openServiceDetail(id);
            });
            /* Тап «Записаться» → сразу к бронированию */
            const btn = card.querySelector('.btn-book');
            if (btn) {
                btn.addEventListener('click', function (e) {
                    e.stopPropagation();
                    const service = getServiceById(id);
                    if (!service) return;
                    State.service = service;
                    goToBooking();
                });
            }
        });

        list.style.opacity = '1';
    }, 80);
}

function serviceCardHtml(s) {
    return `
    <div class="service-card" data-id="${s.id}">
        <div class="service-card-photo" style="background:${s.gradient}">
            <span style="filter:drop-shadow(0 4px 12px rgba(0,0,0,0.15))">${s.emoji}</span>
        </div>
        <div class="service-card-body">
            <div class="service-card-category">${s.categoryName}</div>
            <div class="service-card-name">${s.name}</div>
            <div class="service-card-footer">
                <div class="service-card-price-wrap">
                    <span class="service-card-price">${s.priceText}</span>
                    <span class="service-card-duration">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                        </svg>
                        ${s.durationText}
                    </span>
                </div>
                <button class="btn-book">Записаться</button>
            </div>
        </div>
    </div>`;
}

/* ─── ЭКРАН 3: Карточка услуги ─── */
function openServiceDetail(serviceId) {
    const service = getServiceById(serviceId);
    if (!service) return;
    State.service = service;

    /* Заголовок */
    document.getElementById('service-screen-title').textContent = service.name;
    document.getElementById('service-detail-name').textContent  = service.name;
    document.getElementById('service-detail-price').textContent = service.priceText;
    document.getElementById('service-detail-duration').textContent = service.durationText;
    document.getElementById('service-detail-description').textContent = service.description;

    /* Галерея */
    renderGallery(service.photos);

    /* Что включено */
    const inc = document.getElementById('service-includes');
    inc.innerHTML = `
        <div class="service-includes-title">Что включено</div>
        ${service.includes.map(item => `
            <div class="service-include-item">
                <span class="service-include-dot"></span>
                ${item}
            </div>
        `).join('')}
    `;

    /* Telegram: BackButton + MainButton */
    TG.BackButton.show(goBack);
    TG.MainButton.show('Записаться', goToBooking);
    TG.enableClosingConfirmation();

    Router.go('service');
}

/* ─── Галерея (карточка услуги) ─── */
function renderGallery(photos) {
    const track = document.getElementById('service-gallery-track');
    const dots  = document.getElementById('service-gallery-dots');
    let current = 0;

    track.innerHTML = photos.map((p, i) => `
        <div class="gallery-slide" style="background:${p.gradient}">
            <span style="font-size:84px;filter:drop-shadow(0 4px 16px rgba(0,0,0,0.12))">${p.emoji}</span>
        </div>
    `).join('');

    dots.innerHTML = photos.map((_, i) => `
        <div class="gallery-dot ${i === 0 ? 'active' : ''}"></div>
    `).join('');

    if (photos.length <= 1) {
        dots.style.display = 'none';
        return;
    }
    dots.style.display = 'flex';

    /* Свайп по галерее */
    let startX = 0;
    const wrap = document.getElementById('service-gallery-wrap');

    wrap.addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
    }, { passive: true });

    wrap.addEventListener('touchend', e => {
        const diff = startX - e.changedTouches[0].clientX;
        if (Math.abs(diff) > 40) {
            if (diff > 0 && current < photos.length - 1) current++;
            if (diff < 0 && current > 0) current--;
            updateGallery();
        }
    });

    function updateGallery() {
        track.style.transform = `translateX(-${current * 100}%)`;
        dots.querySelectorAll('.gallery-dot').forEach((d, i) => {
            d.classList.toggle('active', i === current);
        });
    }
}

/* ─── ЭКРАН 4: Выбор даты и времени ─── */
function goToBooking() {
    if (!State.service) return;

    /* Подсказка выбранной услуги */
    document.getElementById('booking-hint-name').textContent  = State.service.name;
    document.getElementById('booking-hint-price').textContent = State.service.priceText;

    /* Сброс выбора */
    State.date = null;
    State.time = null;

    /* Рендер дат */
    const dates = generateDates();
    renderDates(dates);

    /* Автовыбор первой доступной даты */
    selectDate(dates[0]);

    /* Telegram: BackButton + MainButton заблокирована */
    TG.BackButton.show(goBack);
    TG.MainButton.show('Далее →', goToConfirm);
    TG.MainButton.disable();
    TG.enableClosingConfirmation();

    /* Синхронизируем кнопку браузера */
    document.getElementById('booking-next-btn').disabled = true;

    Router.go('booking');
}

/* Рендер горизонтальной полосы дат */
function renderDates(dates) {
    const scroll = document.getElementById('dates-scroll');
    scroll.innerHTML = dates.map(d => `
        <button class="date-btn ${d.isToday ? 'today' : ''}" data-date="${d.dateStr}">
            <span class="date-day">${d.dayShort}</span>
            <span class="date-num">${d.num}</span>
            <span class="date-month">${d.month}</span>
        </button>
    `).join('');

    scroll.querySelectorAll('.date-btn').forEach(btn => {
        btn.addEventListener('click', function () {
            const dateStr = this.dataset.date;
            const found   = dates.find(d => d.dateStr === dateStr);
            if (found) selectDate(found);
        });
    });
}

/* Выбор даты и рендер слотов */
function selectDate(dateObj) {
    State.date = dateObj.dateStr;
    State.time = null;

    /* Подсвечиваем активную дату */
    document.querySelectorAll('.date-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.date === dateObj.dateStr);
    });

    /* Рендер слотов */
    const slots   = generateSlots(dateObj.dateStr);
    const current = document.querySelector('.time-chip.active')?.dataset.period || 'all';
    renderSlots(slots, current);

    /* Сбрасываем фильтр на «Все» */
    document.querySelectorAll('.time-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.period === 'all');
    });

    /* Фильтр слотов по времени суток */
    document.querySelectorAll('.time-chip').forEach(chip => {
        chip.onclick = function () {
            document.querySelectorAll('.time-chip').forEach(c => c.classList.remove('active'));
            this.classList.add('active');
            renderSlots(slots, this.dataset.period);
        };
    });
}

/* Рендер сетки слотов */
function renderSlots(slots, period) {
    const grid = document.getElementById('slots-grid');

    const visible = period === 'all'
        ? slots
        : slots.filter(s => s.period === period);

    if (!visible.length) {
        grid.innerHTML = `<div class="slots-empty">Нет слотов в это время</div>`;
        return;
    }

    grid.innerHTML = visible.map(s => `
        <button class="slot-btn ${!s.available ? 'occupied' : ''}" data-time="${s.time}" ${!s.available ? 'disabled' : ''}>
            ${s.time}
        </button>
    `).join('');

    grid.querySelectorAll('.slot-btn:not(.occupied)').forEach(btn => {
        btn.addEventListener('click', function () {
            /* Haptic feedback при выборе слота */
            TG.Haptic.light();

            /* Снимаем выделение с остальных */
            grid.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
            this.classList.add('selected');

            State.time = this.dataset.time;

            /* Разблокируем кнопку «Далее» */
            TG.MainButton.enable();
            document.getElementById('booking-next-btn').disabled = false;
        });
    });
}

/* ─── ЭКРАН 5: Подтверждение ─── */
function goToConfirm() {
    if (!State.service || !State.date || !State.time) return;

    /* Заполняем карточку-итог */
    document.getElementById('confirm-emoji').textContent        = State.service.emoji;
    document.getElementById('confirm-service-name').textContent = State.service.name;
    document.getElementById('confirm-date').textContent         = formatDateFull(State.date, State.time);
    document.getElementById('confirm-price').textContent        = State.service.priceText;

    /* Данные клиента из Telegram */
    fillClientCard();

    /* Сохраняем черновик в CloudStorage */
    TG.Cloud.set('booking_draft', {
        serviceId: State.service.id,
        date:      State.date,
        time:      State.time,
    });

    /* Telegram */
    TG.BackButton.show(goBack);
    TG.MainButton.show('Подтвердить запись ✓', confirmBooking);
    TG.enableClosingConfirmation();

    Router.go('confirm');
}

/* Карточка клиента из Telegram initData */
function fillClientCard() {
    const user     = State.user;
    const nameEl   = document.getElementById('client-name-el');
    const usernEl  = document.getElementById('client-username-el');
    const avatarEl = document.getElementById('client-avatar-letter');

    if (user) {
        const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ');
        nameEl.textContent   = fullName || 'Пользователь';
        usernEl.textContent  = user.username ? '@' + user.username : '';
        avatarEl.textContent = (user.first_name || 'П').charAt(0).toUpperCase();
    } else {
        /* В браузере — демо-данные */
        nameEl.textContent   = 'Гость';
        usernEl.textContent  = 'Открыто в браузере';
        avatarEl.textContent = 'Г';
    }
}

/* ─── ЭКРАН 6: Успех ─── */
function confirmBooking() {
    if (!State.service || !State.date || !State.time) return;

    /* Имитация запроса к серверу (в MVP — сразу успех) */
    TG.MainButton.showProgress();

    setTimeout(() => {
        TG.MainButton.hideProgress();
        TG.MainButton.hide();

        /* Сохраняем запись локально */
        const apt = {
            id:          generateId(),
            serviceId:   State.service.id,
            serviceName: State.service.name,
            serviceEmoji: State.service.emoji,
            date:        State.date,
            time:        State.time,
            price:       State.service.priceText,
            status:      'upcoming',
        };
        saveAppointment(apt);

        /* Чистим черновик */
        TG.Cloud.remove('booking_draft');

        /* Разрешаем закрытие */
        TG.disableClosingConfirmation();

        /* Заполняем экран успеха */
        document.getElementById('success-emoji').textContent        = State.service.emoji;
        document.getElementById('success-service-name').textContent = State.service.name;
        document.getElementById('success-date').textContent         = formatDateFull(State.date, State.time);
        document.getElementById('success-price').textContent        = State.service.priceText;

        /* Haptic-уведомление об успехе */
        TG.Haptic.success();

        /* BackButton → на главную */
        TG.BackButton.show(goHome);

        Router.go('success');
    }, 900);
}

/* ─── ЭКРАН 7: Мои записи ─── */
function goAppointments() {
    renderAppointments();
    TG.MainButton.hide();
    TG.BackButton.hide();
    TG.disableClosingConfirmation();
    setNavActive('appointments-nav', 'appointments');
    Router.go('appointments');
}

function renderAppointments() {
    const body = document.getElementById('appointments-body');
    const all  = getAppointments();

    const today    = new Date(); today.setHours(0,0,0,0);
    const upcoming = all.filter(a => a.status === 'upcoming' && new Date(a.date) >= today);
    const past     = all.filter(a => a.status === 'completed' || (a.status === 'upcoming' && new Date(a.date) < today) || a.status === 'cancelled');

    if (!all.length) {
        body.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">💅</div>
                <div class="empty-title">Пока нет записей</div>
                <div class="empty-text">Выберите услугу и запишитесь<br>к Люсе прямо сейчас!</div>
                <br>
                <button class="btn-primary" style="width:auto;padding:0 32px" onclick="goHome()">Выбрать услугу →</button>
            </div>`;
        return;
    }

    let html = '';

    if (upcoming.length) {
        html += `<div class="apts-section-title">Предстоящие</div>`;
        html += upcoming.map(a => aptCardHtml(a, false)).join('');
    }

    if (past.length) {
        html += `<div class="apts-section-title">История</div>`;
        html += past.map(a => aptCardHtml(a, true)).join('');
    }

    body.innerHTML = html;

    /* Кнопки «Отменить» и «Записаться снова» */
    body.querySelectorAll('[data-action]').forEach(btn => {
        btn.addEventListener('click', function () {
            const action = this.dataset.action;
            const id     = this.dataset.id;
            if (action === 'cancel')     startCancelAppointment(id);
            if (action === 'rebook')     rebookAppointment(id);
            if (action === 'reschedule') rebookAppointment(id);
        });
    });
}

function aptCardHtml(a, isPast) {
    const dateStr  = formatDateFull(a.date, a.time);
    const badgeCls = isPast || a.status === 'cancelled'
        ? 'apt-badge-past'
        : 'apt-badge-upcoming';
    const badgeTxt = a.status === 'cancelled'
        ? 'Отменена'
        : isPast ? 'Завершена' : 'Запись';

    const actions = isPast || a.status === 'cancelled'
        ? `<button class="btn-sm btn-sm-accent" data-action="rebook" data-id="${a.id}">Записаться снова</button>`
        : `<button class="btn-sm btn-sm-ghost" data-action="reschedule" data-id="${a.id}">Перенести</button>
           <button class="btn-sm btn-sm-danger" data-action="cancel" data-id="${a.id}">Отменить</button>`;

    return `
    <div class="appointment-card ${isPast ? 'past' : ''}">
        <div class="apt-top">
            <div>
                <div class="apt-service">${a.serviceEmoji || '💅'} ${a.serviceName}</div>
                <div class="apt-date">${dateStr}</div>
            </div>
            <span class="apt-badge ${badgeCls}">${badgeTxt}</span>
        </div>
        <div class="apt-price">${a.price}</div>
        <div class="apt-actions">${actions}</div>
    </div>`;
}

/* ─── ЭКРАН 7а: Подтверждение отмены ─── */
function startCancelAppointment(id) {
    const all = getAppointments();
    const apt = all.find(a => a.id === id);
    if (!apt) return;

    State.cancelingId = id;

    /* Заполняем карточку */
    document.getElementById('cancel-card-details').innerHTML = `
        <div class="cancel-service">${apt.serviceEmoji || '💅'} ${apt.serviceName}</div>
        <div class="cancel-datetime">${formatDateFull(apt.date, apt.time)}</div>
    `;

    TG.BackButton.show(goBack);
    Router.go('cancel');
}

function doCancelAppointment() {
    if (!State.cancelingId) return;
    cancelAppointmentById(State.cancelingId);
    State.cancelingId = null;
    TG.Haptic.warning();
    /* Возвращаемся к списку и обновляем */
    Router.go('appointments');
    renderAppointments();
}

/* Повторная запись той же услуги */
function rebookAppointment(id) {
    const all = getAppointments();
    const apt = all.find(a => a.id === id);
    if (!apt) return;
    const service = getServiceById(apt.serviceId);
    if (!service) return;
    State.service = service;
    goToBooking();
}

/* ─── Навигация-утилиты ─── */
function goHome() {
    Router.replace('home');
    TG.BackButton.hide();
    TG.MainButton.hide();
    TG.disableClosingConfirmation();
    setNavActive('home-nav', 'home');
}

function goBack() {
    const went = Router.back();
    if (!went) goHome();
    else updateControls();
}

/* Обновляем Telegram-кнопки под текущий экран */
function updateControls() {
    const screen = Router.current;
    if (screen === 'home' || screen === 'appointments' || screen === 'success') {
        TG.BackButton.hide();
        TG.MainButton.hide();
        TG.disableClosingConfirmation();
    }
}

/* Подсвечиваем активный пункт нижней навигации */
function setNavActive(navId, active) {
    const nav = document.getElementById(navId);
    if (!nav) return;
    nav.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.nav === active);
    });
}

/* ─── Поделиться с другом ─── */
function shareApp() {
    TG.Haptic.light();
    const url  = `https://t.me/${MASTER.botUsername}/app`;
    const text = 'Записываюсь к крутому мастеру маникюра Люсе 💅 Советую!';
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;

    const wa = window.Telegram && window.Telegram.WebApp;
    if (wa && wa.openTelegramLink) {
        wa.openTelegramLink(shareUrl);
    } else if (navigator.share) {
        navigator.share({ title: 'Люся — Nail-мастер', text, url });
    } else {
        window.open(shareUrl, '_blank');
    }
}

/* ─── Оффер-модалка ─── */
function showOfferModal() {
    if (localStorage.getItem('beauty_offer_shown_v2')) return;

    const modal = document.getElementById('offer-modal');
    if (!modal) return;

    setTimeout(() => modal.classList.add('visible'), 350);

    function closeModal() {
        modal.classList.remove('visible');
        localStorage.setItem('beauty_offer_shown_v2', '1');
    }

    document.getElementById('offer-cta').addEventListener('click', function (e) {
        e.preventDefault();
        const url = `https://t.me/${MASTER.botUsername}?start=from_app`;
        const wa = window.Telegram && window.Telegram.WebApp;
        if (wa && wa.openTelegramLink) {
            wa.openTelegramLink(url);
        } else {
            window.open(url, '_blank');
        }
        closeModal();
    });

    document.getElementById('offer-skip').addEventListener('click', closeModal);
}

/* ─── Глобальный экспорт функций для inline-обработчиков ─── */
window.goHome        = goHome;
window.goBack        = goBack;
window.goAppointments = goAppointments;
