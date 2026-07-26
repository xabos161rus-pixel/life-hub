import { expect } from '@playwright/test';
import { openApp, test } from './fixtures';

// Метрика иконок. Проверяется НАСТОЯЩИЙ штрих в пикселях, а не атрибут: у
// lucide stroke-width задан в системе координат 24×24, поэтому один и тот же
// атрибут даёт разную толщину на разных размерах. Именно это и было сломано —
// от 1.02px на мелких иконках до 2.92px на крупных.
//
// real = attr * size / 24

/** Маршруты, которые дают заметно разный набор иконок. Адреса настоящие: у
 *  приложения нет маршрута-заглушки, и опечатка вроде «/today» вместо «/»
 *  отрисовала бы голый каркас — тест прошёл бы, ничего не измерив. Поэтому
 *  openRoute ниже требует заголовок экрана. */
const ROUTES = ['/', '/tasks', '/home', '/notes', '/goals', '/more/finance', '/more/habits'];

/** Открыть маршрут и убедиться, что экран действительно отрисовался. */
async function openRoute(page: import('@playwright/test').Page, route: string) {
  await openApp(page, route);
  await expect(page.locator('header h1')).toBeVisible();
}

interface Glyph {
  name: string;
  size: number;
  real: number;
}

async function collectGlyphs(page: import('@playwright/test').Page): Promise<Glyph[]> {
  return page.evaluate(() => {
    const out: { name: string; size: number; real: number }[] = [];
    for (const svg of document.querySelectorAll<SVGElement>('svg.lucide')) {
      const box = svg.getBoundingClientRect();
      if (!box.width || !box.height) continue; // скрытые не считаем
      // Атрибут может быть переопределён CSS — берём вычисленное значение,
      // именно оно и рисуется.
      const attr = parseFloat(getComputedStyle(svg).strokeWidth);
      if (!Number.isFinite(attr)) continue;
      const size = Math.round(box.width);
      out.push({
        name: svg.getAttribute('class')?.split(/\s+/).find((c) => c.startsWith('lucide-')) ?? '?',
        size,
        real: Math.round((attr * size) / 24 / 0.01) * 0.01,
      });
    }
    return out;
  });
}

test('штрих иконок одинаков в пикселях независимо от размера', async ({ page }) => {
  await openApp(page);
  const all: Glyph[] = [];
  for (const route of ROUTES) {
    await openRoute(page, route);
    all.push(...(await collectGlyphs(page)));
  }
  expect(all.length, 'иконки вообще не нашлись — тест бы прошёл впустую').toBeGreaterThan(40);

  // Самопроверка измерителя: пока правило .lucide{stroke-width:1.75} стояло в
  // CSS, разброс был ~2.9x. Если измеритель вдруг начнёт возвращать одно и то
  // же число для всех, тест обязан об этом узнать — поэтому размеры тоже
  // должны быть разными.
  const sizes = new Set(all.map((g) => g.size));
  expect(sizes.size, 'все иконки одного размера — измерять нечего').toBeGreaterThan(2);

  const reals = all.map((g) => g.real);
  const min = Math.min(...reals);
  const max = Math.max(...reals);
  // Допуск: обычный вес 1.5, акцентный 2.0, на заливке 2.4. Разброс внутри
  // этой вилки законен, вне — значит где-то остался старый механизм.
  expect(min, `слишком тонкий штрих: ${JSON.stringify(all.filter((g) => g.real === min))}`).toBeGreaterThanOrEqual(1.4);
  expect(max, `слишком жирный штрих: ${JSON.stringify(all.filter((g) => g.real === max))}`).toBeLessThanOrEqual(2.5);
});

test('размеры иконок — только со ступеней шкалы', async ({ page }) => {
  // 14/16/18/20/24 — рабочие ступени, 32 и 40 — дисплейные. Всё остальное
  // означает, что в разметку снова просочилось произвольное число: 17 и 18
  // рядом глазом не различить, а вместе они читаются как небрежность.
  const ALLOWED = new Set([14, 16, 18, 20, 24, 32, 40]);
  await openApp(page);
  const bad: Glyph[] = [];
  for (const route of ROUTES) {
    await openRoute(page, route);
    bad.push(...(await collectGlyphs(page)).filter((g) => !ALLOWED.has(g.size)));
  }
  expect(bad, `иконки вне шкалы: ${JSON.stringify(bad)}`).toEqual([]);
});

test('кнопки-иконки в шапке одинаковой ширины на всех экранах', async ({ page }) => {
  // Раньше слот right в Screen набивали шестью разными обёртками (p-1, p-1.5,
  // p-2, size-10, дважды без ничего) — при переходе между разделами правый
  // край шапки заметно прыгал.
  const withHeaderButton = ['/', '/tasks', '/stats', '/more/cycle'];
  await openApp(page);
  const widths: { route: string; w: number }[] = [];
  for (const route of withHeaderButton) {
    await openRoute(page, route);
    const btn = page.locator('header a[aria-label], header button[aria-label]').last();
    await expect(btn, `на ${route} кнопки в шапке нет`).toBeVisible();
    const box = await btn.boundingBox();
    if (box) widths.push({ route, w: Math.round(box.width) });
  }
  expect(widths.length, 'ни одной кнопки в шапке не нашлось').toBeGreaterThanOrEqual(3);
  const uniq = new Set(widths.map((x) => x.w));
  expect([...uniq], `ширины разъехались: ${JSON.stringify(widths)}`).toHaveLength(1);
});
