-- Сброс схемы: удаляет все таблицы и функцию, затем создаёт заново.
-- Запускать только в SQL Editor Supabase.

-- Удаляем таблицы в обратном порядке зависимостей (CASCADE убирает связи)
DROP TABLE IF EXISTS notifications_queue CASCADE;
DROP TABLE IF EXISTS subscriptions       CASCADE;
DROP TABLE IF EXISTS appointments        CASCADE;
DROP TABLE IF EXISTS clients             CASCADE;
DROP TABLE IF EXISTS blocked_slots       CASCADE;
DROP TABLE IF EXISTS schedule            CASCADE;
DROP TABLE IF EXISTS service_photos      CASCADE;
DROP TABLE IF EXISTS services            CASCADE;
DROP TABLE IF EXISTS masters             CASCADE;
DROP TABLE IF EXISTS themes              CASCADE;

DROP FUNCTION IF EXISTS set_updated_at CASCADE;
