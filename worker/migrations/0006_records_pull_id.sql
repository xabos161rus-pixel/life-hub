-- Курсор pull стал составным: (updated_at, id) вместо одного updated_at.
-- Причина: выборка идёт с ORDER BY updated_at, id, а курсор двигался только по
-- updated_at — записи с одинаковым миллисекундным штампом, не поместившиеся на
-- страницу, терялись навсегда (следующий запрос просил строго больше значения).
-- Применять: wrangler d1 migrations apply life-hub-sync --remote
-- Примечание: запрос с row values корректен и на старом индексе, просто
-- медленнее — этот индекс возвращает ему seek.
--
-- Старый индекс (account_id, updated_at) покрывает только фильтр; хвост ORDER BY
-- по id SQLite досортировывает сам. Добавляем id третьей колонкой, чтобы
-- и фильтр, и сортировка, и пагинация шли по одному индексу.
CREATE INDEX IF NOT EXISTS idx_records_pull_id ON records (account_id, updated_at, id);

-- Прежний индекс становится префиксом нового и больше не нужен.
DROP INDEX IF EXISTS idx_records_pull;
