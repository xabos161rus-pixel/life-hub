import { test, expect, openApp } from './fixtures';

// Оформление: акцентные темы и строка версии в настройках.

test('акцент меняется мгновенно и переживает перезагрузку', async ({ page }) => {
  await openApp(page, '/more/settings');

  const accentOf = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--app-accent').trim(),
    );
  const indigo = await accentOf();

  await page.getByRole('button', { name: /Изумруд/ }).click();
  // Настройка едет асинхронно (Dexie → live-запрос → эффект) — ждём, не меряем сразу.
  await expect.poll(accentOf).not.toBe(indigo);
  const emerald = await accentOf();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.accent))
    .toBe('emerald');

  // Настройка device-local, как тема: живёт в IndexedDB и держится после
  // перезагрузки.
  await page.reload();
  await expect(page.getByRole('button', { name: /Изумруд/ })).toBeVisible();
  await expect.poll(accentOf).toBe(emerald);

  // Возврат к классике — атрибут снимается, токены дефолтные.
  await page.getByRole('button', { name: /Индиго/ }).click();
  await expect.poll(accentOf).toBe(indigo);
  expect(await page.evaluate(() => document.documentElement.dataset.accent)).toBeUndefined();
});

test('строка версии живая и открывает «Что нового»', async ({ page }) => {
  await openApp(page, '/more/settings');
  const versions = await page.evaluate(async () => {
    const { APP_VERSION } = await import('/src/lib/changelog.ts');
    return APP_VERSION;
  });
  // Версия из changelog, не хардкод.
  await expect(page.getByText(`Версия ${versions}`)).toBeVisible();
  await page.getByRole('button', { name: /Что нового/ }).click();
  await expect(page.getByText('Что нового')).toHaveCount(2); // кнопка + заголовок окна
});
