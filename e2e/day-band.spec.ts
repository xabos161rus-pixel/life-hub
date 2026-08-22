import { test, expect, openApp } from './fixtures';

// Полоса дня на «Сегодня»: сводка из ячеек вместо трёх отдельных блоков.
//
// Главное, что здесь проверяется, — полоса берёт на себя только СДЕЛАННОЕ.
// Отметка сил и галочка привычки ставятся одним тапом прямо с «Сегодня»
// (в EnergyTodayLine это записано прямым текстом: переход в раздел ради
// отметки убил бы ежедневный ритуал). Поэтому пока дело не сделано, блок
// обязан оставаться развёрнутым, и никакая экономия места этого не отменяет.
//
// Про погоду: она в полосе может быть, а может не быть — запрос уходит в сеть,
// которой в тестах нет, но ответ прошлого запуска мог осесть в кэше. Поэтому
// проверяются ячейки сил и привычек, а не полоса целиком.

test('силы: пока не отмечено — шкала на месте, после отметки уходит в полосу', async ({ page }) => {
  await openApp(page, './');

  // Пока отметки нет — шкала 1–5 развёрнута, отметка в один тап.
  const scale = page.getByRole('button', { name: /^[1-5] — / });
  await expect(scale).toHaveCount(5);
  // Ячейки «Силы» в полосе ещё нет: показывать нечего. Саму полосу не
  // проверяем на отсутствие — в ней может стоять погода, если ответ пришёл
  // из кэша прошлого запуска.
  await expect(page.getByRole('button', { name: 'Изменить отметку сил' })).toHaveCount(0);

  await page.getByRole('button', { name: /^4 — / }).click();

  // Отметка сделана: шкала свернулась, значение переехало в полосу.
  await expect(scale).toHaveCount(0);
  const band = page.getByLabel('Сегодня коротко');
  await expect(band).toBeVisible();
  await expect(band).toContainText('Силы');
  await expect(band).toContainText('4');

  // Тап по ячейке возвращает шкалу — изменить отметку можно в любой момент.
  await band.getByRole('button', { name: 'Изменить отметку сил' }).click();
  await expect(scale).toHaveCount(5);
});

test('привычки: список сворачивается только когда все закрыты', async ({ page }) => {
  await openApp(page, './');
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const now = new Date().toISOString();
    const base = (id: string) => ({ id, createdAt: now, updatedAt: now, deletedAt: null });
    await db.habits.bulkPut([
      { ...base('hb1'), name: 'Отжимания', emoji: '💪', color: '#57c07a', goalId: null, schedule: { type: 'daily', interval: 1 }, sortOrder: 1000, archivedAt: null },
      { ...base('hb2'), name: 'Дыхание', emoji: '🌬️', color: '#4a9de0', goalId: null, schedule: { type: 'daily', interval: 1 }, sortOrder: 2000, archivedAt: null },
    ] as never[]);
  });
  await page.goto('./');

  // Две привычки на сегодня — список развёрнут, галочки под рукой.
  await expect(page.getByText('Отжимания')).toBeVisible();
  await expect(page.getByText('Дыхание')).toBeVisible();

  // Закрываем одну: список ОСТАЁТСЯ — вторая ещё ждёт.
  await page.getByText('Отжимания').click();
  await expect(page.getByText('Дыхание')).toBeVisible();

  // Закрываем вторую: теперь сворачивается в ячейку со счётчиком.
  await page.getByText('Дыхание').click();
  const band = page.getByLabel('Сегодня коротко');
  await expect(band).toContainText('Привычки');
  await expect(band).toContainText('2 из 2');
  await expect(page.getByText('Отжимания')).toHaveCount(0);

  // И разворачивается обратно по тапу.
  await band.getByRole('button', { name: 'Показать привычки' }).click();
  await expect(page.getByText('Отжимания')).toBeVisible();
});
