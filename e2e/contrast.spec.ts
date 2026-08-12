import { test, expect, openApp } from './fixtures';
import type { Page } from '@playwright/test';

// Контраст текста и иконок — по пикселям в живом браузере.
//
// Проверять таблицу токенов бесполезно: она показывает потенциал, а не факт.
// Один и тот же цвет лежит на трёх поверхностях и на собственной подложке, и
// на каждой контраст свой. Плюс кнопки залиты градиентом — там backgroundColor
// прозрачный, и «цвет фона» приходится брать из стопов.
//
// Два подводных камня, на которых первая версия этой проверки врала:
//  — getComputedStyle отдаёт цвет строкой 'oklch(0.7 0.185 20)', и наивный
//    парсер читает три числа как RGB. Считаем через canvas: он разворачивает
//    любой CSS-цвет в те пиксели, которые видит человек;
//  — фон надо брать с САМОГО элемента, а не с родителя, иначе у кнопки
//    находится фон карточки под ней.
// Отсюда самопроверка ниже: белое на чёрном обязано дать 21.

const SCREENS = ['/', '/tasks', '/notes', '/calendar', '/goals', '/stats', '/home',
  '/more/finance', '/more/focus', '/more/habits', '/more/learning', '/more/energy',
  '/more/places', '/more/family', '/more/cycle', '/more/settings'];

interface Finding { что: string; класс: string; контраст: number; нужно: number }

async function scan(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1;
    const ctx = cv.getContext('2d', { willReadFrequently: true })!;
    const px = (css: string): number[] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return +((x + 0.05) / (y + 0.05)).toFixed(2);
    };
    if (ratio([0, 0, 0], [255, 255, 255]) !== 21) throw new Error('замер контраста сломан');

    const over = (fg: number[], bg: number[]) =>
      [0, 1, 2].map((i) => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3])));
    const stops = (img: string) =>
      (img && img !== 'none'
        ? (img.match(/(?:rgba?|oklch|oklab|hsla?)\([^)]*\)|#[0-9a-f]{3,8}/gi) || [])
        : []
      ).map(px).filter((c) => c[3] > 0);
    const bgOf = (el: Element): number[][] => {
      const stack: number[][] = [];
      let grad: number[][] = [];
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const g = stops(cs.backgroundImage);
        if (g.length) { grad = g; break; }
        const c = px(cs.backgroundColor);
        if (c[3] > 0) stack.push(c);
        if (c[3] >= 0.999) break;
      }
      const bases = grad.length ? grad : [[14, 14, 21, 1]];
      return bases.map((base) => {
        let out = [base[0], base[1], base[2]];
        for (let i = stack.length - 1; i >= 0; i--) out = over(stack[i], out);
        return out;
      });
    };

    const found: Finding[] = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
      const ownText = [...el.childNodes]
        .filter((n) => n.nodeType === 3).map((n) => n.textContent!.trim()).join('');
      const isIcon = el.tagName === 'svg';
      if (!ownText && !isIcon) continue;
      const fg = px(isIcon ? (cs.stroke !== 'none' ? cs.stroke : cs.color) : cs.color);
      const c = Math.min(...bgOf(el).map((bg) => ratio(over(fg, bg), bg)));
      const size = parseFloat(cs.fontSize) || 17;
      const bold = Number(cs.fontWeight) >= 600;
      // Пороги WCAG AA: 3.0 для крупного текста и графики, 4.5 для обычного.
      const need = isIcon || size >= 24 || (bold && size >= 19) ? 3 : 4.5;
      if (c < need) {
        found.push({
          что: (isIcon ? `иконка ${el.getAttribute('class') ?? ''}` : ownText).slice(0, 40),
          класс: (el.getAttribute('class') || '').slice(0, 70),
          контраст: c, нужно: need,
        });
      }
    }
    return found;
  });
}

// Акцентные темы меняют только акцентные токены, поэтому их прогон короче:
// экраны, где акцент представлен всеми ролями — текстом, заливкой кнопок,
// чипами, Fab и градиентом шапки. Дефолтный индиго проверяется по всем
// экранам, как раньше.
const ACCENT_SCREENS = ['/', '/tasks', '/notes', '/goals', '/home', '/more/settings'];

async function auditScreens(
  page: Page,
  theme: 'dark' | 'light',
  accent: string,
  screens: string[],
): Promise<string[]> {
  await page.evaluate(
    ({ t, a }) => {
      document.documentElement.classList.toggle('light', t === 'light');
      if (a === 'indigo') delete document.documentElement.dataset.accent;
      else document.documentElement.dataset.accent = a;
    },
    { t: theme, a: accent },
  );
  const bad: string[] = [];
  for (const path of screens) {
    // Переход внутри приложения, без перезагрузки: она сбросила бы класс темы,
    // и «светлая» проверялась бы вхолостую.
    await page.evaluate((p) => {
      history.pushState({}, '', p);
      dispatchEvent(new PopStateEvent('popstate'));
    }, path);
    await page.waitForTimeout(400);
    for (const f of await scan(page)) {
      bad.push(`${path} — «${f.что}» ${f.контраст}:1 (нужно ${f.нужно}) [${f.класс}]`);
    }
  }
  return bad;
}

for (const theme of ['dark', 'light'] as const) {
  test(`${theme}: контраст текста и иконок не ниже AA`, async ({ page }) => {
    await openApp(page);
    const bad = await auditScreens(page, theme, 'indigo', SCREENS);
    expect(bad, `пар ниже порога: ${bad.length}`).toEqual([]);
  });

  for (const accent of ['emerald', 'sunset'] as const) {
    test(`${theme} + ${accent}: акцентная палитра не роняет контраст`, async ({ page }) => {
      await openApp(page);
      const bad = await auditScreens(page, theme, accent, ACCENT_SCREENS);
      expect(bad, `пар ниже порога: ${bad.length}`).toEqual([]);
    });
  }
}
