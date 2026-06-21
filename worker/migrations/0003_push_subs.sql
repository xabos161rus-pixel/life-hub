-- Глобальный список push-подписок (для рассылки «вышло обновление» всем
-- устройствам). Отдельно от напоминаний (per-task) и семьи (per-room).
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  sub TEXT NOT NULL,        -- JSON push-подписки
  created_at TEXT
);
