# Life Hub

Личный центр управления жизнью: задачи, цели, привычки, заметки, обучение. PWA для iPhone — устанавливается на экран «Домой» из Safari, работает полностью офлайн.

## Архитектура

- **React 19 + TypeScript + Vite 8**, Tailwind CSS 4 (CSS-first, токены в `src/index.css`)
- **Dexie.js (IndexedDB)** — все данные локально на устройстве; `useLiveQuery` как слой состояния
- **PWA** через vite-plugin-pwa: precache всего билда, `autoUpdate`
- Хостинг: GitHub Pages (`.github/workflows/deploy.yml`), base path `/life-hub/`

### Слой данных (sync-ready)

Каждая запись наследует `BaseEntity` (`id` uuid, `createdAt`, `updatedAt`, `deletedAt` — мягкое удаление). Все записи идут **только** через `src/db/repo.ts` (`create`/`update`/`remove`). Это позволяет добавить облачную синхронизацию в v2: outbox-таблица в Dexie `version(2)` + хук в repo, UI не меняется.

Календарные даты — локальные строки `YYYY-MM-DD` (`src/lib/dates.ts`), чтобы отметка в 23:30 МСК не уезжала на другой день.

### Бэкап

Данные живут только в IndexedDB устройства. Экспорт/импорт JSON — в Настройках. Бейдж на табе «Ещё» напоминает, если бэкапа не было больше 7 дней.

## Разработка

```bash
npm install
npm run dev      # http://localhost:5173/life-hub/
npm run build    # tsc + vite build + service worker
```

## Деплой

Push в `main` → GitHub Actions собирает и публикует на GitHub Pages (~2 мин). На iPhone: перезапустить приложение, обновление подтянется автоматически.

## v2 (не реализовано, по плану)

- Push-напоминания: нужен крошечный push-сервер (Cloudflare Worker cron + Web Push VAPID). iOS 16.4+ поддерживает web push только для установленных PWA.
- Облачная синхронизация: outbox в repo.ts + любой лёгкий бэкенд (Supabase free tier).
