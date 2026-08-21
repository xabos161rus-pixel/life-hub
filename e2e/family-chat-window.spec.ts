import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openApp, test } from './fixtures';

// Лента чата рисует хвост переписки, а не всю её историю.
//
// Замер до этой правки на 1500 сообщениях (переписка семьи примерно за год):
// 14 000 узлов в разметке, лента высотой 186 000 пикселей, прокрутка вешала
// вкладку на десятки секунд. Тест держит границу: сколько бы ни накопилось,
// на экране остаётся обозримое окно, а прошлое доливается при подъёме.

async function seedChat(page: Page, count: number) {
  await page.evaluate(async (count) => {
    const { db } = await import('/src/db/db.ts');
    const { generateKey } = await import('/src/lib/crypto.ts');
    const key = await generateKey();
    const ts = new Date().toISOString();
    await db.family.put({
      id: 'f1', familyId: 'f1', familyToken: 't', familyKey: key, familyName: 'Наши',
      selfMemberId: 'me', lastSeq: 0, lastReadSeq: 0, enabled: true, joinedAt: ts,
      keyEpoch: 0, keyRing: { '0': key },
    } as never);
    await db.familyMembers.bulkPut([
      { id: 'me', familyId: 'f1', seq: 1, displayName: 'Влад', color: '#5b7cfa', joinedAt: ts, leftAt: null, removedAt: null },
      { id: 'p1', familyId: 'f1', seq: 2, displayName: 'Отец', color: '#10b981', joinedAt: ts, leftAt: null, removedAt: null },
    ] as never[]);
    const msgs = Array.from({ length: count }, (_, i) => ({
      clientMsgId: `m${i}`,
      familyId: 'f1',
      seq: i + 1,
      senderMemberId: i % 2 ? 'me' : 'p1',
      text: `Сообщение ${i}`,
      createdAt: new Date(Date.now() - (count - i) * 60_000).toISOString(),
      deliveryState: 'sent',
    }));
    await db.familyMessages.bulkPut(msgs as never[]);
  }, count);
  await page.goto('/more/family?g=f1');
}

/** Сколько пузырей сообщений реально в разметке. */
function bubbles(page: Page) {
  return page.getByText(/^Сообщение \d+$/);
}

test('длинная переписка не грузит в ленту всю историю', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedChat(page, 300);

  // Последнее сообщение на экране — чат открывается с конца.
  await expect(page.getByText('Сообщение 299')).toBeVisible();

  const shown = await bubbles(page).count();
  // Окно, а не вся история: точное число — деталь реализации, важна граница.
  expect(shown).toBeGreaterThan(10);
  expect(shown).toBeLessThan(120);

  // Самого первого сообщения в разметке нет — оно за пределами окна.
  await expect(page.getByText('Сообщение 0', { exact: true })).toHaveCount(0);
});

test('подъём к началу доливает прошлые сообщения и не роняет позицию', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedChat(page, 300);
  await expect(page.getByText('Сообщение 299')).toBeVisible();

  const before = await bubbles(page).count();
  const lane = page.locator('[class*="overscroll-contain"]').first();

  await lane.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event('scroll', { bubbles: true }));
  });

  // Долилась следующая страница переписки.
  await expect.poll(async () => bubbles(page).count()).toBeGreaterThan(before);

  // И человек не улетел в начало: прокрутка сместилась на высоту дорисованного,
  // то есть сообщение, на которое он смотрел, осталось на месте.
  const top = await lane.evaluate((el) => el.scrollTop);
  expect(top).toBeGreaterThan(100);
});

test('подъём уходит глубже предела чтения из базы', async ({ page }) => {
  // Лента не только рисует окно — она и читает из базы хвост, иначе каждое
  // входящее сообщение поднимало бы из базы все фотографии и голосовые
  // переписки. Здесь важно, что одно окно не заперло другое: человек,
  // листающий вглубь, должен доходить до сообщений старше предела чтения,
  // а не упираться в невидимую стену.
  await openApp(page, '/more/family');
  await seedChat(page, 900);
  await expect(page.getByText('Сообщение 899')).toBeVisible();

  const lane = page.locator('[class*="overscroll-contain"]').first();
  const target = page.getByText('Сообщение 340', { exact: true });

  // Поднимаемся страницами, пока не дойдём до цели. Она лежит на 560 сообщений
  // от конца — заведомо глубже, чем читается за один раз.
  for (let i = 0; i < 14 && (await target.count()) === 0; i++) {
    const shown = await bubbles(page).count();
    await lane.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    await expect.poll(async () => bubbles(page).count()).toBeGreaterThan(shown);
  }

  await expect(target).toHaveCount(1);
});
