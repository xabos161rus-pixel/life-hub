import { test, expect, openApp } from './fixtures';
import type { Page } from '@playwright/test';

// Зона касания меньше 44×44 — самый частый дефект мобильной вёрстки и
// отдельный пункт в HIG. Считаем не по размеру самой кнопки: в приложении
// есть HIT_SLOP_44 — невидимый псевдоэлемент, который расширяет зону, не
// раздувая вид. Поэтому меряем ::after вместе с кнопкой.

const SCREENS = ['/', '/tasks', '/notes', '/calendar', '/goals', '/home',
  '/more/finance', '/more/habits', '/more/cycle', '/more/settings'];

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
