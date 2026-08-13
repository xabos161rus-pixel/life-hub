import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openApp, test } from './fixtures';

// Дневник энергии: одна отметка в день со шкалой 1–5. Главное, что здесь
// проверяется, — день без отметки остаётся «нет данных» и нигде не
// превращается в ноль: иначе неделя ночных смен выглядит как провал, которого
// не было.

/** Ключ даты 'YYYY-MM-DD' со сдвигом в днях от сегодня — как todayKey/addDaysKey. */
function dayKey(shift = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + shift);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Отметки энергии прямо в БД: [сдвиг в днях, уровень]. */
async function seedEnergy(page: Page, marks: Array<[number, number]>) {
  await page.evaluate(
    async ({ marks }) => {
      const { db } = await import('/src/db/db.ts');
      const now = new Date().toISOString();
      await db.energyLogs.clear();
      await db.energyLogs.bulkPut(
        marks.map(([shift, level], i) => {
          const d = new Date();
          d.setDate(d.getDate() + shift);
          const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          return {
            id: `en${i}`,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            date,
            level,
          };
        }),
      );
    },
    { marks },
  );
}

const scale = (page: Page) => page.getByRole('button', { name: /^\d — / });

test('отметка ставится одним тапом с «Сегодня» и переживает перезагрузку', async ({ page }) => {
  await openApp(page, '/');

  await expect(page.getByText('не отмечено')).toBeVisible();
  await page.getByRole('button', { name: '4 — Хорошо' }).click();
  await expect(page.getByText('Хорошо')).toBeVisible();

  await page.reload();
  await expect(page.getByText('Хорошо')).toBeVisible();
  await expect(page.getByRole('button', { name: '4 — Хорошо' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('повторный тап по той же точке снимает отметку, день снова без данных', async ({ page }) => {
  await openApp(page, '/');

  await page.getByRole('button', { name: '2 — Тяжеловато' }).click();
  await expect(page.getByText('Тяжеловато')).toBeVisible();

  await page.getByRole('button', { name: '2 — Тяжеловато' }).click();
  await expect(page.getByText('не отмечено')).toBeVisible();

  // Именно «нет данных», а не ноль: после перезагрузки состояние прежнее.
  await page.reload();
  await expect(page.getByText('не отмечено')).toBeVisible();
});

test('выключенный раздел «Энергия» молчит на «Сегодня»', async ({ page }) => {
  await openApp(page, '/', {
    navConfig: { bottom: ['home', 'tasks', 'notes', 'calendar'], hidden: ['energy'] },
  });

  // Сначала дожидаемся отрисованного экрана: проверка отсутствия на пустом
  // первом кадре зелена при любой поломке гейта и ничего не доказывает.
  await expect(page.getByRole('heading', { name: 'Сегодня' })).toBeVisible();
  await expect(scale(page)).toHaveCount(0);
  await expect(page.getByText('не отмечено')).toHaveCount(0);
});

test('пропущенный день дозаполняется из раздела', async ({ page }) => {
  await openApp(page, '/more/energy');

  // Ячейка вчерашнего дня подписана датой и состоянием — по ней и ищем.
  const yesterday = page.getByRole('button', { name: /нет отметки/ }).nth(12);
  await expect(yesterday).toBeVisible();
  await yesterday.click();

  await page.getByRole('button', { name: 'Прёт' }).click();
  await expect(page.getByRole('button', { name: /Прёт/ })).toHaveCount(1);

  await page.reload();
  await expect(page.getByRole('button', { name: /Прёт/ })).toHaveCount(1);
});

test('аналитика молчит, пока отметок меньше семи', async ({ page }) => {
  await openApp(page, '/');
  await seedEnergy(page, [
    [0, 4],
    [-1, 4],
    [-2, 4],
    [-3, 4],
    [-4, 4],
    [-5, 4],
  ]);

  await page.goto('/stats');
  // Ждём соседний блок, который на этом экране есть всегда: без якоря проверка
  // отсутствия срабатывает на пустой оболочке экрана, пока Dexie ещё отвечает.
  await expect(page.getByRole('heading', { name: 'Эффективность' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Энергия' })).toHaveCount(0);
});

test('в статистике средняя считается по отметкам, а пропуски не идут за ноль', async ({
  page,
}) => {
  await openApp(page, '/');
  // Семь отметок всего, но в последнюю неделю попали только три пятёрки.
  // Средняя за 7 дней = 5.0. Если бы пропуск шёл нулём, вышло бы 2.1.
  await seedEnergy(page, [
    [0, 5],
    [-1, 5],
    [-2, 5],
    [-8, 1],
    [-9, 1],
    [-10, 1],
    [-11, 1],
  ]);

  await page.goto('/stats');
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Энергия' }) });
  await expect(card).toContainText('5.0');
  await expect(card).toContainText('отмечено 3 из 7');
  // Прошлая неделя — четыре единицы, значит рост ровно на 4.0.
  await expect(card).toContainText('+4.0 к прошлой неделе');
});

test('столбики по дням недели имеют высоту, а не схлопнуты в ноль', async ({ page }) => {
  await openApp(page, '/');
  await seedEnergy(page, [
    [0, 5],
    [-1, 4],
    [-2, 3],
    [-3, 2],
    [-4, 5],
    [-5, 4],
    [-6, 3],
  ]);
  await page.goto('/stats');

  // Ловит дефект, найденный на живом экране: процентная высота внутри
  // flex-контейнера без явной высоты считается от auto, и график исчезает,
  // оставляя одни подписи.
  const bars = page.getByTestId('weekday-bar');
  await expect(bars).toHaveCount(7);
  const heights = await bars.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().height),
  );
  expect(Math.max(...heights)).toBeGreaterThan(10);
});

test('отметка показывается на своём дне, а не сдвигается на соседний', async ({ page }) => {
  await openApp(page, '/');
  await seedEnergy(page, [[-1, 3]]);
  await page.goto('/more/energy');

  // Ячейки подписаны датой: отметка со вчерашнего ключа обязана стоять именно
  // на вчерашнем дне — сдвиг на день ловится здесь.
  const yesterdayLabel = new RegExp(`${Number(dayKey(-1).slice(8))} .* — Рабочий режим`);
  await expect(page.getByRole('button', { name: yesterdayLabel })).toHaveCount(1);
  await expect(page.getByRole('button', { name: /— Рабочий режим/ })).toHaveCount(1);
});
