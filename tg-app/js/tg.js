/* ================================================
   tg.js — Обёртка Telegram WebApp SDK
   Изолирует вызовы Telegram API от основной логики.
   В браузере (без Telegram) работает как заглушка.
   ================================================ */

const TG = (function () {
    /* Ссылка на объект WebApp (может быть undefined в браузере) */
    const wa = window.Telegram && window.Telegram.WebApp;

    /* Флаг: приложение открыто внутри Telegram */
    const isTelegram = Boolean(wa && wa.initData);

    /* ─── Инициализация ─── */
    function init() {
        if (!wa) return;

        /* Сообщаем Telegram что приложение готово (убирает его лоадер) */
        wa.ready();

        /* Разворачиваем на весь экран сразу */
        wa.expand();

        /* Применяем тему к body */
        applyTheme();

        /* Помечаем body классом для CSS */
        document.body.classList.add('tg-app');
    }

    /* ─── Тема Telegram → CSS-переменные ─── */
    function applyTheme() {
        if (!wa) {
            /* В браузере применяем системную тему */
            const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            document.body.classList.toggle('tg-dark', dark);
            return;
        }

        const p = wa.themeParams || {};

        /* Перезаписываем CSS-переменные из темы Telegram */
        const root = document.documentElement;

        if (p.bg_color)           root.style.setProperty('--tg-bg',           p.bg_color);
        if (p.secondary_bg_color) root.style.setProperty('--tg-secondary-bg', p.secondary_bg_color);
        if (p.text_color)         root.style.setProperty('--tg-text',         p.text_color);
        if (p.hint_color)         root.style.setProperty('--tg-hint',         p.hint_color);
        if (p.link_color)         root.style.setProperty('--tg-link',         p.link_color);
        if (p.button_color)       root.style.setProperty('--tg-button',       p.button_color);
        if (p.button_text_color)  root.style.setProperty('--tg-button-text',  p.button_text_color);

        /* Синхронизируем акцент с кнопкой Telegram */
        if (p.button_color) root.style.setProperty('--accent', p.button_color);
        if (p.button_text_color) root.style.setProperty('--accent-light',
            hexToRgba(p.button_color, 0.12));

        /* Тёмная тема */
        const dark = wa.colorScheme === 'dark';
        document.body.classList.toggle('tg-dark', dark);
        document.body.classList.toggle('tg-light', !dark);
    }

    /* ─── Данные пользователя из initData ─── */
    function getUser() {
        if (!wa || !wa.initDataUnsafe) return null;
        return wa.initDataUnsafe.user || null;
    }

    /* ─── MainButton (главная кнопка внизу экрана Telegram) ─── */
    const MainButton = {
        _handler: null,

        show(text, onClick) {
            if (!wa) return;
            /* Снимаем старый обработчик, чтобы не накапливались */
            if (this._handler) wa.MainButton.offClick(this._handler);
            this._handler = onClick;
            wa.MainButton.setText(text);
            if (onClick) wa.MainButton.onClick(this._handler);
            wa.MainButton.show();
        },

        hide() {
            if (!wa) return;
            if (this._handler) wa.MainButton.offClick(this._handler);
            this._handler = null;
            wa.MainButton.hide();
        },

        setText(text) {
            if (!wa) return;
            wa.MainButton.setText(text);
        },

        enable() {
            if (!wa) return;
            wa.MainButton.enable();
            wa.MainButton.color = wa.themeParams.button_color || '#2AABEE';
        },

        disable() {
            if (!wa) return;
            wa.MainButton.disable();
            wa.MainButton.color = '#aaaaaa';
        },

        showProgress() {
            if (!wa) return;
            wa.MainButton.showProgress();
        },

        hideProgress() {
            if (!wa) return;
            wa.MainButton.hideProgress();
        },
    };

    /* ─── BackButton ─── */
    const BackButton = {
        _handler: null,

        show(onClick) {
            if (!wa) return;
            if (this._handler) wa.BackButton.offClick(this._handler);
            this._handler = onClick;
            if (onClick) wa.BackButton.onClick(this._handler);
            wa.BackButton.show();
        },

        hide() {
            if (!wa) return;
            if (this._handler) wa.BackButton.offClick(this._handler);
            this._handler = null;
            wa.BackButton.hide();
        },
    };

    /* ─── Haptic Feedback ─── */
    const Haptic = {
        light()   { if (wa) wa.HapticFeedback.impactOccurred('light');  },
        medium()  { if (wa) wa.HapticFeedback.impactOccurred('medium'); },
        success() { if (wa) wa.HapticFeedback.notificationOccurred('success'); },
        error()   { if (wa) wa.HapticFeedback.notificationOccurred('error');   },
        warning() { if (wa) wa.HapticFeedback.notificationOccurred('warning'); },
    };

    /* ─── CloudStorage (черновик флоу записи) ─── */
    const Cloud = {
        /* Сохраняем черновик как JSON-строку (лимит 4096 байт) */
        set(key, value) {
            if (wa && wa.CloudStorage) {
                wa.CloudStorage.setItem(key, JSON.stringify(value));
            } else {
                /* Fallback — sessionStorage */
                try { sessionStorage.setItem('tg_' + key, JSON.stringify(value)); } catch {}
            }
        },

        get(key, callback) {
            if (wa && wa.CloudStorage) {
                wa.CloudStorage.getItem(key, (err, val) => {
                    try { callback(null, val ? JSON.parse(val) : null); }
                    catch { callback(null, null); }
                });
            } else {
                try {
                    const val = sessionStorage.getItem('tg_' + key);
                    callback(null, val ? JSON.parse(val) : null);
                } catch {
                    callback(null, null);
                }
            }
        },

        remove(key) {
            if (wa && wa.CloudStorage) {
                wa.CloudStorage.removeItem(key);
            } else {
                try { sessionStorage.removeItem('tg_' + key); } catch {}
            }
        },
    };

    /* ─── Подтверждение закрытия ─── */
    function enableClosingConfirmation() {
        if (wa) wa.enableClosingConfirmation();
    }

    function disableClosingConfirmation() {
        if (wa) wa.disableClosingConfirmation();
    }

    /* ─── Попап (простой алерт Telegram) ─── */
    function showAlert(message, callback) {
        if (wa) {
            wa.showAlert(message, callback);
        } else {
            alert(message);
            if (callback) callback();
        }
    }

    function showConfirm(message, callback) {
        if (wa) {
            wa.showConfirm(message, callback);
        } else {
            const res = confirm(message);
            callback(res);
        }
    }

    /* ─── Вспомогательная: HEX → rgba ─── */
    function hexToRgba(hex, alpha) {
        if (!hex) return `rgba(42,171,238,${alpha})`;
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    /* ─── Публичный API ─── */
    return {
        isTelegram,
        init,
        applyTheme,
        getUser,
        MainButton,
        BackButton,
        Haptic,
        Cloud,
        enableClosingConfirmation,
        disableClosingConfirmation,
        showAlert,
        showConfirm,
    };
})();
