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

// Этот тест долго лежал как fixme с пометкой «может, дело в синтетических
// событиях». Дело было не в них. Замер показал: пока палец идёт к проекту
// ниже, он задевает нижние 72px, включается авто-скролл на 11px за кадр
// (≈660px/с) — и список уходит на все доступные 368px за доли секунды. Цель
// уезжает выше пальца, под пальцем пустота, hitTest даёт null, а null в
// finish означал «не делать ничего». Молча. Чинилось двумя правками: разгон
// скорости от края зоны и запрет обнулять цель промахом.
test('задачу можно перетащить в другой проект', async ({ page }) => {
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

/** Геометрия прокручиваемого контейнера списка — в нём и живёт авто-скролл. */
async function scrollerBox(page: Page) {
  return page.evaluate(() => {
    const sec = document.querySelector('[data-drop-key]');
    let el = sec?.parentElement ?? null;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, scrollTop: el.scrollTop, max: el.scrollHeight - el.clientHeight };
      }
      el = el.parentElement;
    }
    return null;
  });
}

/** Много задач — чтобы списку было куда прокручиваться. */
async function seedMany(page: Page, n: number) {
  await page.evaluate(async (n) => {
    const { db } = await import('/src/db/db.ts');
    const now = new Date().toISOString();
    await db.projects.clear();
    await db.tasks.clear();
    await db.projects.bulkPut([
      { id: 'p1', createdAt: now, updatedAt: now, deletedAt: null, name: 'Бизнес', color: '#5b7cfa', emoji: '💼', sortOrder: 1000, archivedAt: null },
      { id: 'p2', createdAt: now, updatedAt: now, deletedAt: null, name: 'Здоровье', color: '#3aa35e', emoji: '🏃', sortOrder: 2000, archivedAt: null },
    ]);
    await db.tasks.bulkPut(
      Array.from({ length: n }, (_, i) => ({
        id: `t${i}`, createdAt: now, updatedAt: now, deletedAt: null,
        title: `Задача ${i}`, notes: '', projectId: 'p1', goalId: null, priority: 0,
        dueDate: null, dueTime: null, duration: null, remindBefore: null,
        completedAt: null, checklist: [], recurrence: null, tags: [], sortOrder: (i + 1) * 1000,
      })),
    );
  }, n);
  await page.goto('/tasks');
  await expect(page.getByRole('heading', { name: 'Задачи' })).toBeVisible();
}

test('авто-скролл у края не уносит список из-под пальца', async ({ page }) => {
  // Было: 11px за кадр — ≈660px/с, весь экран задач за полсекунды. Человек вёл
  // задачу к проекту ниже, задевал краевую зону, и цель уезжала выше пальца
  // раньше, чем он до неё доходил. Теперь скорость растёт от нуля на границе
  // зоны: чуть зашёл — чуть подкрутилось.
  await openApp(page, '/tasks');
  await seedMany(page, 40);

  await hold(page, 'Задача 0');
  const box = (await scrollerBox(page))!;
  expect(box.max, 'списку некуда прокручиваться — мерить нечего').toBeGreaterThan(300);

  // На 2px внутрь краевой зоны: это «едва задел», а не «прижал к краю».
  await page.mouse.move(200, box.bottom - 70, { steps: 6 });
  await page.waitForTimeout(600);
  const after = (await scrollerBox(page))!;
  await page.mouse.up();

  const moved = after.scrollTop - box.scrollTop;
  expect(moved, 'у границы зоны скролл обязан идти, иначе до цели не добраться').toBeGreaterThan(0);
  // 600мс × 60Гц ≈ 36 кадров. Со старой постоянной скоростью — под 400px, то
  // есть весь запас; с разгоном у границы — десятки.
  expect(moved, `за 600мс уехало ${moved}px — снова уносит`).toBeLessThan(150);
});

test('промах в пустоту не теряет цель, на которую наводились', async ({ page }) => {
  // Ниже последней секции нет ни одной drop-зоны, и hitTest там даёт null.
  // Раньше null стирал цель, а finish на пустой цели молчал: ни переноса, ни
  // тоста, ни объяснения — жест просто исчезал.
  await openApp(page, '/tasks');
  await seed(page);

  await hold(page, 'Позвонить поставщику');
  const health = (await page.getByText('Здоровье', { exact: true }).first().boundingBox())!;
  await page.mouse.move(health.x + 40, health.y + 30, { steps: 10 });
  await page.waitForTimeout(150);
  await expect(page.locator('[data-drop-key="p2"]')).toHaveClass(/ring-accent/);

  // Уводим в пустоту заведомо ниже всех секций и отпускаем там.
  const empty = await page.evaluate(() => {
    const rects = [...document.querySelectorAll('[data-drop-key]')].map((n) => n.getBoundingClientRect());
    return Math.max(...rects.map((r) => r.bottom)) + 24;
  });
  await page.mouse.move(200, empty, { steps: 4 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(400);

  expect(await projectOf(page, 't1')).toBe('p2');
});
