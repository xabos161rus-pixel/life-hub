import { test, expect, openApp } from './fixtures';
import type { Page } from '@playwright/test';

// Зона касания меньше 44×44 — самый частый дефект мобильной вёрстки и
// отдельный пункт в HIG. Считаем не по размеру самой кнопки: в приложении
// есть HIT_SLOP_44 — невидимый псевдоэлемент, который расширяет зону, не
// раздувая вид. Поэтому меряем ::after вместе с кнопкой.

const SCREENS = ['/', '/tasks', '/notes', '/calendar', '/goals', '/home',
  '/more/finance', '/more/habits', '/more/cycle', '/more/settings',
  // Аудит нашёл здесь кнопки 21×21 и 37×37 — экраны просто не были в списке.
  '/more/ai', '/more/focus', '/more/learning', '/more/energy', '/more/places',
  '/home/profile', '/share'];

async function small(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.pointerEvents === 'none') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      let w = r.width;
      let h = r.height;
      // HIT_SLOP_44 живёт на ::after с отрицательными отступами — computed
      // размеры псевдоэлемента дают реальную зону.
      const a = getComputedStyle(el, '::after');
      if (a.content !== 'none' && a.position === 'absolute') {
        const pw = parseFloat(a.width);
        const ph = parseFloat(a.height);
        if (Number.isFinite(pw) && pw > w) w = pw;
        if (Number.isFinite(ph) && ph > h) h = ph;
      }
      if (w < 44 || h < 44) {
        const label = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30);
        bad.push(`«${label}» ${Math.round(w)}×${Math.round(h)} [${(el.getAttribute('class') || '').slice(0, 50)}]`);
      }
    }
    return bad;
  });
}

test('зона касания не меньше 44×44', async ({ page }) => {
  await openApp(page);
  const bad = new Set<string>();
  for (const path of SCREENS) {
    await page.evaluate((p) => {
      history.pushState({}, '', p);
      dispatchEvent(new PopStateEvent('popstate'));
    }, path);
    await page.waitForTimeout(400);
    for (const b of await small(page)) bad.add(`${path}: ${b}`);
  }
  expect([...bad], `мелких зон: ${bad.size}`).toEqual([]);
});

test('расширение зоны касания не сдвигает кнопки', async ({ page }) => {
  // HIT_SLOP_44 несёт relative — а Tailwind решает конфликт двух position не
  // по порядку в атрибуте class, а по порядку правил в CSS. На элементе,
  // который уже absolute, relative побеждал, и кнопка уезжала из своего угла
  // в поток. Так крестик на карточке «Защитите свои данные» переехал от
  // правого верхнего угла к заголовку — тест на 44×44 этого не видел, зона-то
  // стала правильной.
  await openApp(page);
  const bad = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('button, a[href]')) {
      const cs = getComputedStyle(el);
      const after = getComputedStyle(el, '::after');
      const hasSlop = after.content !== 'none' && after.position === 'absolute'
        && parseFloat(after.width) >= 40;
      if (!hasSlop) continue;
      // У элемента с расширенной зоной position обязан остаться тем, что
      // задумал автор: relative допустим, static — нет (значит его сбросили),
      // absolute/fixed — значит автор позиционировал сам и relative не пришёл.
      if (cs.position === 'static') {
        out.push(`${el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 20)}: position static`);
      }
      // Кнопка с классом absolute обязана остаться absolute.
      // Утилиту ищем как отдельный класс, а не подстрокой: сам хит-слоп несёт
      // after:absolute, и наивный поиск по слову объявлял нарушением каждую
      // кнопку с расширенной зоной.
      const classes = (el.getAttribute('class') || '').split(/\s+/);
      const cls = classes.join(' ');
      void cls;
      if (classes.includes('absolute') && cs.position !== 'absolute') {
        out.push(`${el.getAttribute('aria-label') || '?'}: класс absolute, а position ${cs.position}`);
      }
      if (classes.includes('fixed') && cs.position !== 'fixed') {
        out.push(`${el.getAttribute('aria-label') || '?'}: класс fixed, а position ${cs.position}`);
      }
    }
    return out;
  });
  expect(bad).toEqual([]);
});
