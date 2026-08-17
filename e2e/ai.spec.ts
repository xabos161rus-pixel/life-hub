import type { Page } from '@playwright/test';
import { openApp, test, expect } from './fixtures';

// Раздел «ИИ» (этап 1, заглушка). Воркер в изоляции недоступен, поэтому
// эндпоинт /ai/chat мокается на уровне сети — ответ в формате echoReply.

/** Синк-конфиг напрямую в Dexie: aiClient без него отказывает ещё до сети. */
async function seedSyncAccount(page: Page) {
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const { generateKey } = await import('/src/lib/crypto.ts');
    await db.sync.put({
      id: 'config',
      accountId: 'acc-e2e',
      authToken: 'tok-e2e',
      key: await generateKey(),
      enabled: true,
      lastPullAt: '',
      lastPushAt: '',
      lastSyncedAt: '',
    });
  });
}

test('раздел скрыт с «Главной» по умолчанию, но открывается по прямому адресу', async ({ page }) => {
  await openApp(page, '/home');
  // Флаг выключен — пункта «ИИ» в списке «Главной» нет.
  await expect(page.getByRole('link', { name: 'ИИ', exact: true })).toHaveCount(0);

  await page.goto('/more/ai');
  await expect(page.getByPlaceholder('Сообщение…')).toBeVisible();
});

test('первый вход заводит ровно один чат — и после перезагрузки он всё ещё один', async ({ page }) => {
  await openApp(page, '/more/ai');
  await expect(page.getByPlaceholder('Сообщение…')).toBeVisible();
  await expect
    .poll(async () => page.evaluate(async () => {
      const { db } = await import('/src/db/db.ts');
      return (await db.llmChats.toArray()).filter((c) => !c.deletedAt).length;
    }))
    .toBe(1);

  await page.goto('/more/ai');
  await expect(page.getByPlaceholder('Сообщение…')).toBeVisible();
  // Ждём вторичного захода эффекта: число чатов не должно вырасти.
  await page.waitForTimeout(400);
  const after = await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    return (await db.llmChats.toArray()).filter((c) => !c.deletedAt).length;
  });
  expect(after).toBe(1);
});

test('без настроенной синхронизации отправка даёт понятную ошибку, не пустоту', async ({ page }) => {
  await openApp(page, '/more/ai');
  const input = page.getByPlaceholder('Сообщение…');
  await input.fill('привет');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await expect(page.getByText('Включите синхронизацию в Настройках — она нужна для авторизации.')).toBeVisible();
});

test('сквозной тракт: вопрос → эхо-ответ с ценой → история переживает перезагрузку', async ({ page }) => {
  // Мок воркера: тот же формат, что отдаёт echoReply в worker/src/index.js.
  await page.route('**/ai/chat', (route) =>
    route.fulfill({
      contentType: 'application/json',
      json: {
        content: '**Заглушка-эхо.** Ответ для теста.',
        model: 'echo',
        usage: { in: 12, out: 34 },
      },
    }),
  );
  await openApp(page, '/more/ai');
  await seedSyncAccount(page);

  const input = page.getByPlaceholder('Сообщение…');
  await input.fill('вопрос для эха');
  await page.getByRole('button', { name: 'Отправить' }).click();

  // Ответ отрисован markdown-ом, метаданные — токены и цена заглушки одной
  // строкой (просто «бесплатно» совпало бы ещё и с лейблом модели).
  await expect(page.getByText('Заглушка-эхо.')).toBeVisible();
  await expect(page.getByText('12→34 · бесплатно')).toBeVisible();

  await page.goto('/more/ai');
  await expect(page.getByText('Заглушка-эхо.')).toBeVisible();
  // Заголовок чата взялся из первого вопроса.
  await expect(page.getByRole('heading', { name: 'вопрос для эха' })).toBeVisible();
});
