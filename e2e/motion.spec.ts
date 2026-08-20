import { test, expect, openApp } from './fixtures';

// Системное «уменьшение движения» должно гасить анимации ВСЕ, включая те, что
// заданы инлайновым style: до атрибута style утилита motion-reduce: не
// дотягивается в принципе, а таких мест в приложении пять.
test.describe('уменьшение движения', () => {
  test('анимации и переходы выключены', async ({ page }) => {
    await openApp(page);
    // emulateMedia на странице, а не test.use({reducedMotion}) на контексте:
    // через use эмуляция до страницы не доезжала, и тест «проходил», ничего
    // не включив. Проверка ниже как раз для того, чтобы такое не повторилось.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    const slow = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        const ms = (v: string) =>
          v.split(',').map((x) => (x.includes('ms') ? parseFloat(x) : parseFloat(x) * 1000));
        for (const d of [...ms(cs.transitionDuration), ...ms(cs.animationDuration)]) {
          if (d > 1) {
            bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} = ${d}ms`);
            break;
          }
        }
      }
      return bad.slice(0, 5);
    });
    expect(slow).toEqual([]);
  });
});

test('при обычных настройках анимации на месте', async ({ page }) => {
  // Обратная проверка: если блок reduce случайно применится всем, интерфейс
  // станет дёрганым, а тест выше об этом не скажет — он и так зелёный.
  await openApp(page);
  const any = await page.evaluate(() =>
    [...document.querySelectorAll('body *')].some((el) => {
      const d = getComputedStyle(el).transitionDuration;
      return d.split(',').some((x) => (x.includes('ms') ? parseFloat(x) : parseFloat(x) * 1000) > 1);
    }),
  );
  expect(any).toBe(true);
});

test('фокус клавиатуры видно даже там, где обводка снята', async ({ page }) => {
  await openApp(page, '/more/focus');
  await page.waitForTimeout(400);
  const visible = await page.evaluate(() => {
    // Поле с outline-none: индикация фокуса обязана пробиться сквозь утилиту.
    const el = document.querySelector<HTMLElement>('input.outline-none, input[class*="outline-none"]');
    if (!el) return 'поле с outline-none не найдено';
    el.focus();
    if (!el.matches(':focus-visible')) return 'нет :focus-visible';
    // У текстовых полей обводку снимает index.css (она ложилась второй рамкой
    // поверх собственной подсветки поля), а фокус показывает кольцо —
    // box-shadow по форме поля. Годится любая из двух индикаций, лишь бы
    // фокус не пропадал бесследно.
    const cs = getComputedStyle(el);
    const outlined = parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== 'none';
    const ringed = cs.boxShadow !== 'none' && cs.boxShadow !== '';
    return outlined || ringed ? 'видно' : `не видно: outline=${cs.outlineWidth}, shadow=${cs.boxShadow}`;
  });
  expect(visible).toBe('видно');
});
