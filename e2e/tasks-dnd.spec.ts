import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openApp, test } from './fixtures';

// Перетаскивание в разделе «Задачи» — то, что работало ДО появления переноса
// подпроектов и обязано работать после.
//
// Тестов на это не было вовсе, а порция с подпроектами вынесла машинку
// удержания из Section в общий хук и переписала расчёт позиции. Один раз замена
// уже задела соседний обработчик — правка refreshDrop для проектов сломала
// вызов у задач, и поймала это только сборка. Что не ломает типы, не поймает
// никто, кроме такого теста.

async function seed(page: Page) {
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const now = new Date().toISOString();
    const base = (id: string) => ({ id, createdAt: now, updatedAt: now, deletedAt: null });
    await db.projects.clear();
    await db.tasks.clear();
    await db.projects.bulkPut([
      { ...base('p1'), name: 'Бизнес', color: '#5b7cfa', emoji: '💼', sortOrder: 1000, archivedAt: null },
      { ...base('p2'), name: 'Здоровье', color: '#3aa35e', emoji: '🏃', sortOrder: 2000, archivedAt: null },
    ]);
    await db.tasks.put({
      ...base('t1'), title: 'Позвонить поставщику', notes: '', projectId: 'p1',
      goalId: null, priority: 0, dueDate: null, dueTime: null, duration: null,
      remindBefore: null, completedAt: null, checklist: [], recurrence: null,
      tags: [], sortOrder: 1000,
    });
  });
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Задачи' })).toBeVisible();
}

/** Удержание элемента и перенос пальцем. hover, а не mouse.move по координатам:
 *  он доскроллит и дождётся, пока элемент перестанет быть перекрытым. */
async function hold(page: Page, text: string) {
  const el = page.getByText(text, { exact: true }).first();
  await el.scrollIntoViewIfNeeded();
  await el.hover();
  await page.mouse.down();
  await page.waitForTimeout(650); // порог удержания 400мс, с запасом
  return el;
}

async function projectOf(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const { db } = await import('/src/db/db.ts');
    return (await db.tasks.get(id))?.projectId ?? null;
  }, id);
}

// ЗНАЕМ, ЧТО НЕ ПРОХОДИТ, и это не регрессия: тот же тест падает на origin/main,
// то есть до всех правок этой порции. Под управлением Playwright перенос
// доходит до конца визуально — плашка едет за курсором, секция-цель
// подсвечивается, — но запись в базу не происходит. Отличить «сломано в
// приложении» от «синтетические pointer-события ведут себя иначе, чем палец»
// отсюда нельзя: на настоящем тач-устройстве этот путь ни разу не проверялся.
// Оставлен как fixme, а не удалён: удалить — значит забыть.
test.fixme('задачу можно перетащить в другой проект', async ({ page }) => {
  await openApp(page, '/tasks');
  await seed(page);
  expect(await projectOf(page, 't1')).toBe('p1');

  await hold(page, 'Позвонить поставщику');
  const target = (await page.getByText('Здоровье', { exact: true }).first().boundingBox())!;
  await page.mouse.move(target.x + 40, target.y + 40, { steps: 12 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(400);

  expect(await projectOf(page, 't1')).toBe('p2');
});

test('проекты верхнего уровня меняются местами', async ({ page }) => {
  await openApp(page, '/tasks');
  await seed(page);

  await hold(page, 'Здоровье');
  // Тянем выше «Бизнеса» — и НЕ вправо, иначе это будет вложение, а не порядок.
  const biz = (await page.getByText('Бизнес', { exact: true }).first().boundingBox())!;
  await page.mouse.move(20, biz.y - 10, { steps: 12 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(400);

  const order = await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const ps = await db.projects.toArray();
    return ps.sort((a, b) => a.sortOrder - b.sortOrder).map((p) => p.name);
  });
  expect(order).toEqual(['Здоровье', 'Бизнес']);
});

test('обычный тап по заголовку по-прежнему сворачивает секцию', async ({ page }) => {
  // Удержание подавляет клик — но только СВОЙ. Сломай подавление, и секция
  // перестанет сворачиваться вовсе либо начнёт сворачиваться после переноса.
  await openApp(page, '/tasks');
  await seed(page);

  await expect(page.getByText('Позвонить поставщику')).toBeVisible();
  await page.getByText('Бизнес', { exact: true }).first().click();
  await expect(page.getByText('Позвонить поставщику')).toHaveCount(0);
  await page.getByText('Бизнес', { exact: true }).first().click();
  await expect(page.getByText('Позвонить поставщику')).toBeVisible();
});

test('после переноса заголовок не сворачивается сам', async ({ page }) => {
  await openApp(page, '/tasks');
  await seed(page);

  await hold(page, 'Здоровье');
  await page.mouse.move(20, 300, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  // Задача осталась видна: секция «Бизнес» не свернулась от клика, которого
  // человек не делал.
  await expect(page.getByText('Позвонить поставщику')).toBeVisible();
});
