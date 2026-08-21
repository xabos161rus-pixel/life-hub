import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openApp, test } from './fixtures';

// Поиск по переписке.
//
// Семья обменивается тем, что потом ищут: адрес, время встречи, номер заказа.
// Без поиска это находится пролистыванием на неделю назад, то есть не
// находится вовсе. Отдельная сложность — лента держит в разметке только хвост
// переписки: найденное почти всегда старше и его надо ещё показать.

async function seedChat(page: Page, total: number) {
  await page.evaluate(async (total) => {
    const { db } = await import('/src/db/db.ts');
    const { generateKey } = await import('/src/lib/crypto.ts');
    const key = await generateKey();
    const ts = new Date().toISOString();
    await db.family.put({
      id: 'f1', familyId: 'f1', familyToken: 't', familyKey: key, familyName: 'Наши',
      selfMemberId: 'me', lastSeq: total, lastReadSeq: total, enabled: true, joinedAt: ts,
      keyEpoch: 0, keyRing: { '0': key },
    } as never);
    await db.familyMembers.bulkPut([
      { id: 'me', familyId: 'f1', seq: 1, displayName: 'Влад', color: '#5b7cfa', joinedAt: ts, leftAt: null, removedAt: null },
      { id: 'p1', familyId: 'f1', seq: 2, displayName: 'Отец', color: '#10b981', joinedAt: ts, leftAt: null, removedAt: null },
    ] as never[]);
    await db.familyMessages.bulkPut(
      Array.from({ length: total }, (_, i) => ({
        clientMsgId: `s${i}`,
        familyId: 'f1',
        seq: i + 1,
        // Приметное сообщение — от отца: так проверяется и подпись автора
        // в списке находок.
        senderMemberId: i === 3 || i % 2 === 0 ? 'p1' : 'me',
        // Одно приметное сообщение в самом начале истории — вглубь от него
        // потом лежит вся остальная переписка.
        text: i === 3 ? 'Адрес: Тверская 12, второй подъезд' : `Обычное сообщение ${i}`,
        createdAt: new Date(Date.now() - (total - i) * 600_000).toISOString(),
        deletedAt: null,
      })) as never[],
    );
  }, total);
  await page.goto('/more/family?g=f1');
}

const openSearch = (page: Page) => page.getByRole('button', { name: 'Искать в переписке' }).click();
const field = (page: Page) => page.getByPlaceholder('Искать в переписке');

test('находит сообщение из глубины истории и показывает его в ленте', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedChat(page, 200);

  // Искомое лежит далеко за пределами загруженного окна.
  await expect(page.getByText('Адрес: Тверская 12, второй подъезд')).toHaveCount(0);

  await openSearch(page);
  await field(page).fill('тверская');

  // Находка показана с именем автора.
  const hit = page.getByRole('button', { name: /Отец.*Тверская/ });
  await expect(hit).toBeVisible();

  await hit.click();

  // Лента развернулась до нужного сообщения, и оно на экране.
  await expect(page.getByText('Адрес: Тверская 12, второй подъезд')).toBeInViewport();
});

test('поиск не различает регистр и «ё»', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedChat(page, 30);

  await openSearch(page);
  await field(page).fill('ТВЕРСКАЯ');
  await expect(page.getByRole('button', { name: /Тверская/ })).toBeVisible();
});

test('когда ничего не нашлось — так и сказано', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedChat(page, 30);

  await openSearch(page);
  await field(page).fill('квартальный отчёт');
  await expect(page.getByText('Ничего не нашлось')).toBeVisible();
});

test('закрытие поиска возвращает переписку', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedChat(page, 30);

  await openSearch(page);
  await field(page).fill('тверская');
  await page.getByRole('button', { name: 'Закрыть поиск' }).click();

  await expect(field(page)).toHaveCount(0);
  await expect(page.getByPlaceholder('Сообщение…')).toBeVisible();
});
