import { expect } from '@playwright/test';
import { test } from './fixtures';

// Язык интерфейса берётся из браузера: настройка лежит в базе, а её здесь как
// раз и нет. Задаём русскую локаль явно — иначе тест проверял бы английские
// строки, которых человек с русским телефоном не увидит.
test.use({ locale: 'ru-RU' });

// Приложение не должно молча показывать белый экран, если данные не открылись.
//
// Весь запуск стоит за открытием IndexedDB. Откат версии приложения,
// переполнение хранилища, повреждённая база на iOS, приватный режим — и
// человек видел пустоту: ни слова о причине, ни одной кнопки.

test('когда хранилище недоступно, человек видит причину и кнопку, а не пустоту', async ({ page }) => {
  // Самый честный способ смоделировать «базы нет»: убрать API до загрузки
  // приложения — именно так выглядит приватный режим старых браузеров.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Не удалось открыть данные' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Перезагрузить' })).toBeVisible();
  // И экран не пустой в буквальном смысле: что-то отрисовано.
  const text = await page.locator('#root').innerText();
  expect(text.length).toBeGreaterThan(20);
});

test('при исправном хранилище экран сбоя не показывается', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByText('Не удалось открыть данные')).toHaveCount(0);
});
