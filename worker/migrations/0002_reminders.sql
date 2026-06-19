-- Напоминания о задачах перенесены из Workers KV в D1: cron делает SELECT
-- по fire_at (а не KV list каждую минуту, что упиралось в лимит 1000/день).
CREATE TABLE IF NOT EXISTS reminders (
  task_id TEXT PRIMARY KEY,
  fire_at INTEGER NOT NULL,   -- epoch ms
  title TEXT,
  body TEXT,
  subscription TEXT NOT NULL  -- JSON push-подписки
);
CREATE INDEX IF NOT EXISTS idx_reminders_fire ON reminders (fire_at);
