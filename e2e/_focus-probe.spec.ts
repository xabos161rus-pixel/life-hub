import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openApp, test } from './fixtures';

// Проба гоняется на системном Chrome: локально не скачан chromium под эту
// ревизию playwright.
test.use({ channel: 'chrome' });

async function seedFamily(page: Page) {
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const { generateKey } = await import('/src/lib/crypto.ts');
    const key = await generateKey();
    await db.family.put({
      id: 'f1', familyId: 'f1', familyToken: 't', familyKey: key, familyName: 'Наши',
      selfMemberId: 'me', lastSeq: 0, lastReadSeq: 0, enabled: true,
      joinedAt: new Date().toISOString(), keyEpoch: 0, keyRing: { '0': key },
    });
    await db.familyMembers.clear();
    await db.familyMembers.bulkPut([
      { id: 'me', familyId: 'f1', seq: 1, displayName: 'Влад', color: '#5b7cfa', joinedAt: new Date().toISOString(), leftAt: null, removedAt: null },
      { id: 'm0', familyId: 'f1', seq: 1, displayName: 'Отец', color: '#5b7cfa', joinedAt: new Date().toISOString(), leftAt: null, removedAt: null },
    ]);
  });
  await page.goto('/more/family?g=f1');
  await expect(page.getByRole('heading', { name: 'Наши' })).toBeVisible();
}

test('проба: обводка строки ввода чата', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedFamily(page);

  const field = page.getByPlaceholder('Сообщение…');
  await field.tap();
  await page.waitForTimeout(300);

  const styles = await page.evaluate(() => {
    const ta = document.querySelector<HTMLTextAreaElement>('textarea')!;
    const shell = ta.closest('div')!;
    const s = getComputedStyle(ta);
    const sh = getComputedStyle(shell);
    return {
      focusVisible: ta.matches(':focus-visible'),
      taOutline: `${s.outlineStyle} ${s.outlineWidth}`,
      taRadius: s.borderRadius,
      taShadow: s.boxShadow,
      shellBorder: sh.borderColor,
      shellRadius: sh.borderRadius,
      shellShadow: sh.boxShadow,
    };
  });
  console.log('ПОЛЕ ЧАТА:', JSON.stringify(styles, null, 2));
  await page.locator('textarea').locator('xpath=..').screenshot({ path: 'test-results/probe-composer.png' });

  // Круглая кнопка при клавиатурном фокусе: обводка есть, форма не спрямляется.
  await page.keyboard.press('Tab');
  const btn = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const s = getComputedStyle(el);
    return { tag: el.tagName, label: el.getAttribute('aria-label'), outline: `${s.outlineStyle} ${s.outlineWidth}`, radius: s.borderRadius };
  });
  console.log('ФОКУС ТАБОМ:', JSON.stringify(btn, null, 2));
});
