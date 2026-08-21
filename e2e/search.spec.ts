import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openApp, test } from './fixtures';

// Общий поиск по приложению.
//
// Экран открывается с главной одним тапом, и раньше он при открытии читал
// девять таблиц целиком — включая всю переписку семьи вместе с фотографиями,
// голосовыми и кусками файлов (они лежат в тех же строках) и все задачи с их
// снимками. Подписки при этом висели живыми: каждое входящее сообщение
// перечитывало всё заново.

async function seed(page: Page) {
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const { generateKey } = await import('/src/lib/crypto.ts');
    const ts = new Date().toISOString();
    await db.tasks.put({
      id: 't1', title: 'Забрать колёса', notes: '', done: false,
      createdAt: ts, updatedAt: ts, deletedAt: null,
    } as never);
    await db.notes.put({
      id: 'n1', title: 'Колёса и резина', content: '<p>зимние</p>',
      createdAt: ts, updatedAt: ts, deletedAt: null,
    } as never);

    // Переписка с тяжёлым содержимым: 60 сообщений, каждое десятое — фото.
    const key = await generateKey();
    await db.family.put({
      id: 'f1', familyId: 'f1', familyToken: 'x', familyKey: key, familyName: 'Наши',
      selfMemberId: 'me', lastSeq: 60, lastReadSeq: 60, enabled: true, joinedAt: ts,
      keyEpoch: 0, keyRing: { '0': key },
    } as never);
    const photo = 'data:image/jpeg;base64,' + 'A'.repeat(120 * 1024);
    await db.familyMessages.bulkPut(
      Array.from({ length: 60 }, (_, i) => ({
        clientMsgId: `m${i}`, familyId: 'f1', seq: i + 1, senderMemberId: 'p1',
        text: i === 7 ? 'Колёса лежат в гараже' : `Сообщение ${i}`,
        image: i % 10 === 0 ? photo : null,
        createdAt: ts, deletedAt: null,
      })) as never[],
    );
  });
}

/** Считать байты, поднятые из базы. Ставится ДО загрузки страницы: после
 *  перехода на другой экран счётчик в window исчезает вместе со страницей.
 *  Счёт стартует заново на каждой загрузке — то есть меряет ровно тот экран,
 *  который открыли. */
async function countReads(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __read: number };
    w.__read = 0;
    const proto = IDBObjectStore.prototype as unknown as {
      getAll: (...a: unknown[]) => IDBRequest;
    };
    const orig = proto.getAll;
    proto.getAll = function (...args: unknown[]) {
      const req = orig.apply(this, args) as IDBRequest;
      req.addEventListener('success', () => {
        try {
          w.__read += JSON.stringify(req.result ?? '').length;
        } catch {
          /* нестрогая оценка — достаточно порядка величины */
        }
      });
      return req;
    };
  });
}

const readBytes = (page: Page) =>
  page.evaluate(() => (window as unknown as { __read: number }).__read);

test('открытие поиска не поднимает базу — читаем только по запросу', async ({ page }) => {
  await openApp(page, '/');
  await seed(page);

  await countReads(page);
  await page.goto('/search');
  await expect(page.getByPlaceholder('Искать везде…')).toBeVisible();
  await page.waitForTimeout(700);

  // Полное чтение подняло бы больше 700 КБ одних фотографий.
  expect(await readBytes(page)).toBeLessThan(200_000);
});

test('находит по задачам, заметкам и переписке', async ({ page }) => {
  await openApp(page, '/');
  await seed(page);
  await page.goto('/search');

  await page.getByPlaceholder('Искать везде…').fill('колёса');

  await expect(page.getByText('Забрать колёса')).toBeVisible();
  await expect(page.getByText('Колёса и резина')).toBeVisible();
  await expect(page.getByText('Колёса лежат в гараже')).toBeVisible();
});

test('поиск по переписке не различает регистр и «ё» — как внутри чата', async ({ page }) => {
  await openApp(page, '/');
  await seed(page);
  await page.goto('/search');

  await page.getByPlaceholder('Искать везде…').fill('КОЛЕСА');
  await expect(page.getByText('Колёса лежат в гараже')).toBeVisible();
});

test('по одной букве база не читается', async ({ page }) => {
  await openApp(page, '/');
  await seed(page);
  await countReads(page);
  await page.goto('/search');

  await page.getByPlaceholder('Искать везде…').fill('к');
  await page.waitForTimeout(700);

  expect(await readBytes(page)).toBeLessThan(50_000);
});
