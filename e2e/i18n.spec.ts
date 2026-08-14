import { test, expect } from './fixtures';
import { openApp } from './fixtures';

// Английский интерфейс мигрированных разделов. Не перебор всех строк (это
// работа чекера словаря), а смоук на живом экране: язык действительно
// прорастает в разделы, включая пустые состояния и панель редактора.
// Русские тексты этих же экранов держат остальные спеки — фикстура сеет ru.

test('английский: раздел задач — экран, быстрый ввод, шит задачи', async ({ page }) => {
  await openApp(page, '/tasks', { language: 'en' });
  await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
  // Пустое состояние свежей базы.
  await expect(page.getByText('No tasks yet')).toBeVisible();
  await expect(page.getByPlaceholder('What needs to be done?')).toBeVisible();
  // Шит новой задачи: заголовок и подписи полей. FAB подписан общим «Add»
  // (как в русских спеках «Добавить», exact) — 'Add task' занят стрелкой
  // быстрого ввода.
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'New task' })).toBeVisible();
  await expect(page.getByText('Repeat', { exact: true })).toBeVisible();
});

test('английский: быстрый ввод понимает естественные даты', async ({ page }) => {
  await openApp(page, '/tasks', { language: 'en' });
  const input = page.getByPlaceholder('What needs to be done?');
  // Фраза из подсказки Hint — обещание интерфейса, проверяем его дословно.
  await input.fill('call mom tomorrow at 10');
  // Живая подсказка разбора: дата, время.
  await expect(page.getByText('tomorrow · at 10:00')).toBeVisible();
  await input.press('Enter');
  // Задача создана: заголовок очищен от токенов, срок виден строкой задачи.
  const row = page.getByText('call mom', { exact: true });
  await expect(row).toBeVisible();
  await expect(page.getByText('Tomorrow, 10:00')).toBeVisible();
});

test('английский: раздел заметок — список, папки, редактор', async ({ page }) => {
  await openApp(page, '/notes', { language: 'en' });
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  await expect(page.getByText('No notes yet')).toBeVisible();
  // Шит новой папки.
  await page.getByRole('button', { name: 'New folder' }).click();
  await expect(page.getByText('Icon', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create folder' })).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();
  // Редактор: панель инструментов и стили за «Aa».
  await openApp(page, '/notes/new', { language: 'en' });
  await page.locator('.note-editor').click();
  await page.getByRole('button', { name: 'Format' }).click();
  await expect(page.getByRole('button', { name: 'Quote', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Body text' })).toBeVisible();
});
