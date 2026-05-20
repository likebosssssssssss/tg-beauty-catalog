/* ================================================
   router.js — Навигация между экранами SPA
   Управляет показом/скрытием экранов и историей.
   ================================================ */

const Router = (function () {
    /* Стек истории навигации (имена экранов) */
    let history = ['home'];
    /* Текущий активный экран */
    let current = 'home';

    /* Справочник: id экрана → DOM-элемент */
    let screens = {};

    /* ─── Инициализация: сканируем DOM ─── */
    function init() {
        document.querySelectorAll('.screen[data-screen]').forEach(el => {
            screens[el.dataset.screen] = el;
        });
        /* Показываем начальный экран */
        _activate('home', false);
    }

    /* ─── Перейти на экран ─── */
    function go(screenName, addToHistory = true) {
        const to = screens[screenName];

        if (!to) {
            console.warn(`Router: экран "${screenName}" не найден`);
            return;
        }

        /* Пропускаем только если экран уже визуально активен */
        if (screenName === current && to.classList.contains('active')) return;

        const from = screens[current];

        /* Анимация: текущий уходит влево */
        if (from) {
            from.classList.add('slide-left');
            from.classList.remove('active');
            /* Убираем класс после анимации */
            setTimeout(() => from.classList.remove('slide-left'), 280);
        }

        /* Прокручиваем новый экран в начало */
        to.scrollTop = 0;

        /* Активируем новый */
        to.classList.add('active');
        to.classList.remove('slide-left');

        if (addToHistory) {
            history.push(screenName);
        }

        current = screenName;
    }

    /* ─── Назад ─── */
    function back() {
        if (history.length <= 1) return false;

        /* Убираем текущий экран из стека */
        history.pop();

        const prev    = history[history.length - 1];
        const fromEl  = screens[current];
        const toEl    = screens[prev];

        if (!toEl) return false;

        /* Анимация: текущий уходит вправо */
        if (fromEl) {
            fromEl.style.transition = 'none';
            fromEl.classList.add('slide-left');
            fromEl.classList.remove('active');

            requestAnimationFrame(() => {
                fromEl.style.transition = '';
                /* Убираем все классы через 280ms */
                setTimeout(() => {
                    fromEl.classList.remove('slide-left');
                }, 280);
            });
        }

        /* Предыдущий появляется справа налево */
        toEl.scrollTop = 0;
        toEl.classList.add('active');

        current = prev;
        return true;
    }

    /* ─── Переключиться на экран без анимации ─── */
    function replace(screenName) {
        history = [screenName];
        const fromEl = screens[current];
        if (fromEl) fromEl.classList.remove('active', 'slide-left');
        _activate(screenName, false);
        current = screenName;
    }

    /* ─── Внутренний: активировать экран ─── */
    function _activate(screenName, animate) {
        const el = screens[screenName];
        if (!el) return;
        if (!animate) {
            el.style.transition = 'none';
            el.classList.add('active');
            requestAnimationFrame(() => { el.style.transition = ''; });
        } else {
            el.classList.add('active');
        }
    }

    /* ─── Сбросить историю к Home ─── */
    function reset() {
        const prev = screens[current];
        if (prev) {
            prev.classList.remove('active', 'slide-left');
        }
        history = ['home'];
        current = 'home';
        _activate('home', false);
    }

    return {
        init,
        go,
        back,
        replace,
        reset,
        get current() { return current; },
        get historyLength() { return history.length; },
    };
})();
