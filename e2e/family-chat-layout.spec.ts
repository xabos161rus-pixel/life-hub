import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openApp, test } from './fixtures';

// Экран чата: поле ввода всегда на экране, лента занимает большую его часть.
//
// Баннер установки, плашка уведомлений и подсказка про жесты показываются в
// первый день пользования одновременно. Вместе они отнимали у переписки две
// трети экрана, а поле ввода уезжало ниже нижнего края — написать сообщение
// было нельзя вовсе. Ни один тест этого не замечал: элементы existed, просто
// лежали за пределами видимой области.

async function seedFamily(page: Page) {
  await page.evaluate(async () => {
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
    ] as never[]);
    await db.familyMessages.bulkPut([
      { clientMsgId: 'a1', familyId: 'f1', seq: 1, senderMemberId: 'me', text: 'Привет', createdAt: ts, deletedAt: null },
    ] as never[]);
  });
}

/** Первый день пользования: баннер установки ещё не скрыт. */
async function showInstallBanner(page: Page) {
  await page.evaluate(() => localStorage.removeItem('life-hub-install-dismissed'));
}

test('поле ввода остаётся на экране, даже когда показаны все плашки', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedFamily(page);
  await showInstallBanner(page);
  await page.goto('/more/family?g=f1');

  const input = page.getByPlaceholder('Сообщение…');
  await expect(input).toBeVisible();
  await expect(input).toBeInViewport();

  // И в него можно писать — «видно» без «работает» ничего не стоит.
  await input.fill('проверка');
  await expect(input).toHaveValue('проверка');
});

test('переписке достаётся хотя бы половина экрана', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedFamily(page);
  await showInstallBanner(page);
  await page.goto('/more/family?g=f1');

  await expect(page.getByPlaceholder('Сообщение…')).toBeVisible();
  const share = await page.evaluate(() => {
    const lane = document.querySelector('[class*="overscroll-contain"]');
    if (!lane) return 0;
    return lane.getBoundingClientRect().height / window.innerHeight;
  });
  // Порог с запасом: сейчас на тестовом экране 660px выходит 0,44, до правки
  // было бы около 0,2 (три плашки и поле ввода за краем). Ловим поломку, а не
  // колебания в пару процентов от размера шрифта.
  expect(share).toBeGreaterThan(0.4);
});

test('баннер установки уступает место чату, но живёт на обычных экранах', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedFamily(page);
  await showInstallBanner(page);

  // На обычном экране баннер на месте.
  await page.goto('/tasks');
  await expect(page.getByText('Установите на экран «Домой»')).toBeVisible();

  // В чате его нет.
  await page.goto('/more/family?g=f1');
  await expect(page.getByText('Установите на экран «Домой»')).toHaveCount(0);
});
