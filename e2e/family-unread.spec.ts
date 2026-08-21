import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openApp, test } from './fixtures';

// «Вы остановились здесь»: граница прочитанного в ленте.
//
// Семья заходит в чат раз в день, и за это время накапливается десяток
// сообщений. Без метки приходится отлистывать назад и вспоминать, где ты
// закончил читать вчера.

/** Переписка, где прочитано до seq=lastRead включительно. */
async function seedChat(page: Page, total: number, lastRead: number) {
  await page.evaluate(
    async ({ total, lastRead }) => {
      const { db } = await import('/src/db/db.ts');
      const { generateKey } = await import('/src/lib/crypto.ts');
      const key = await generateKey();
      const ts = new Date().toISOString();
      await db.family.put({
        id: 'f1', familyId: 'f1', familyToken: 't', familyKey: key, familyName: 'Наши',
        selfMemberId: 'me', lastSeq: total, lastReadSeq: lastRead, enabled: true, joinedAt: ts,
        keyEpoch: 0, keyRing: { '0': key },
      } as never);
      await db.familyMembers.bulkPut([
        { id: 'me', familyId: 'f1', seq: 1, displayName: 'Влад', color: '#5b7cfa', joinedAt: ts, leftAt: null, removedAt: null },
        { id: 'p1', familyId: 'f1', seq: 2, displayName: 'Отец', color: '#10b981', joinedAt: ts, leftAt: null, removedAt: null },
      ] as never[]);
      await db.familyMessages.bulkPut(
        Array.from({ length: total }, (_, i) => ({
          clientMsgId: `m${i + 1}`,
          familyId: 'f1',
          seq: i + 1,
          senderMemberId: 'p1',
          text: `Сообщение ${i + 1}`,
          createdAt: new Date(Date.now() - (total - i) * 60_000).toISOString(),
          deletedAt: null,
        })) as never[],
      );
    },
    { total, lastRead },
  );
  await page.goto('/more/family?g=f1');
}

test('метка стоит ровно перед первым непрочитанным', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedChat(page, 12, 8);

  const mark = page.getByText('Непрочитанные', { exact: true });
  await expect(mark).toBeVisible();

  // Метка выше девятого сообщения и ниже восьмого — граница ровно там,
  // где человек остановился.
  const y = (loc: ReturnType<typeof page.getByText>) =>
    loc.evaluate((el) => el.getBoundingClientRect().top);
  const markY = await y(mark);
  expect(await y(page.getByText('Сообщение 8', { exact: true }))).toBeLessThan(markY);
  expect(await y(page.getByText('Сообщение 9', { exact: true }))).toBeGreaterThan(markY);
});

test('чат открывается на границе прочитанного, а не в самом низу', async ({ page }) => {
  await openApp(page, '/more/family');
  // Непрочитанных много: если бы лента открылась в конце, начала новых
  // сообщений не было бы видно.
  await seedChat(page, 40, 20);

  await expect(page.getByText('Непрочитанные', { exact: true })).toBeInViewport();
  // Последнее сообщение при этом за нижним краем — мы не в конце ленты.
  await expect(page.getByText('Сообщение 40', { exact: true })).not.toBeInViewport();
});

test('когда всё прочитано, метки нет', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedChat(page, 6, 6);
  await expect(page.getByText('Сообщение 6', { exact: true })).toBeVisible();
  await expect(page.getByText('Непрочитанные', { exact: true })).toHaveCount(0);
});

test('метка не исчезает от того, что чат отметил сообщения прочитанными', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedChat(page, 12, 8);
  await expect(page.getByText('Непрочитанные', { exact: true })).toBeVisible();

  // Открытый чат сразу проставляет отметку прочтения. Метка входа
  // зафиксирована, поэтому граница остаётся на экране, пока не уйдёшь.
  await page.waitForTimeout(600);
  await expect(page.getByText('Непрочитанные', { exact: true })).toBeVisible();
});
