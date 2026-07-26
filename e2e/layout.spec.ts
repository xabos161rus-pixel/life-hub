import { test, expect, openApp } from './fixtures';
import type { Page } from '@playwright/test';

// Дефекты вёрстки, которые уже случались и вернутся при любой правке отступов.
// Проверяются геометрией, а не скриншотами: скриншотный тест на этом проекте
// падал бы от смены шрифта, а сказать, что именно сломалось, не мог.

const SCREENS = ['/', './tasks', './notes', './calendar', './home', './more/finance', './more/cycle'];

/** Элементы, вылезшие за правый край экрана. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const bad: string[] = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // 1px — на округление субпиксельных границ.
      if (r.right > w + 1 || r.left < -1) {
        const cls = (el.className || '').toString().slice(0, 60);
        bad.push(`${el.tagName.toLowerCase()}.${cls} → left=${Math.round(r.left)} right=${Math.round(r.right)} (окно ${w})`);
      }
    }
    return bad.slice(0, 5);
  });
}

for (const path of SCREENS) {
  test(`ничего не вылезает за экран: ${path}`, async ({ page }) => {
    await openApp(page, path);
    await page.waitForTimeout(400);
    expect(await overflowing(page)).toEqual([]);
    // Горизонтальной прокрутки у страницы быть не должно вообще — на телефоне
    // она читается как сломанная вёрстка, а не как возможность.
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(scrollable, `горизонтальный скролл на ${path}`).toBe(false);
  });
}

test('кнопка «+» не перекрывает элементы управления', async ({ page }) => {
  // Настоящая история: FAB садилась в середину экрана и перекрывала сегмент
  // «Год» на 66%, а карандаш раздела — на 93%. Виновата была не сама кнопка, а
  // баннер установки, который поднимал её на свою высоту.
  await openApp(page, './more/finance');
  await page.waitForTimeout(500);
  const fab = page.locator('button').filter({ hasText: /^$/ }).last();
  const box = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    // FAB — единственная круглая кнопка, приклеенная к низу экрана.
    const el = btns.find((b) => {
      const s = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return s.position === 'fixed' && r.width >= 44 && r.width === r.height && r.top > innerHeight / 2;
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    // Что находится под центром кнопки, если её убрать.
    el.style.pointerEvents = 'none';
    const under = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    el.style.pointerEvents = '';
    const interactive = under?.closest('button, a, input, select, [role="tab"]');
    return {
      bottomGap: innerHeight - r.bottom,
      covers: interactive ? interactive.textContent?.trim().slice(0, 40) ?? '(без текста)' : null,
    };
  });
  void fab;
  expect(box, 'FAB не найдена').not.toBeNull();
  // Кнопка должна сидеть у нижнего края, а не висеть посреди экрана.
  expect(box!.bottomGap, 'FAB далеко от нижнего края — её что-то подпирает').toBeLessThan(140);
  expect(box!.covers, 'под кнопкой «+» оказался интерактивный элемент').toBeNull();
});

test('нижняя панель не наезжает на содержимое', async ({ page }) => {
  await openApp(page, './tasks');
  await page.waitForTimeout(400);
  const overlap = await page.evaluate(() => {
    const nav = [...document.querySelectorAll('nav')].pop();
    if (!nav) return 'панель не найдена';
    const navTop = nav.getBoundingClientRect().top;
    // Прокручиваем до конца: именно в этот момент последний элемент списка
    // раньше уезжал под панель.
    const scroller = document.scrollingElement!;
    scroller.scrollTop = scroller.scrollHeight;
    const hidden = [...document.querySelectorAll('main a, main button')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height > 0 && r.top < navTop && r.bottom > navTop + 4;
    });
    return hidden.length ? `${hidden.length} элемент(ов) под панелью` : null;
  });
  expect(overlap).toBeNull();
});
