-- Метаданные приложения: текущая версия (хэш JS-бандла) для cron-сторожа,
-- который рассылает пуш «вышло обновление» при каждом новом деплое.
CREATE TABLE IF NOT EXISTS app_meta (k TEXT PRIMARY KEY, v TEXT);
