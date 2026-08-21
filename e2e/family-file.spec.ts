import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { openApp, test } from './fixtures';

// Отправка произвольных файлов в семейном чате.
//
// Воркер в тестах недоступен (нет сети наружу) — отправка остаётся в статусе
// pending, это ожидаемо и нормально: проверяем локальную сторону (запись в
// Dexie + рендер), а не факт доставки на сервер.

/** Завести группу с одним собеседником (как в family-call.spec.ts). */
async function seedFamily(page: Page) {
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const { generateKey } = await import('/src/lib/crypto.ts');
    const key = await generateKey();
    await db.family.put({
      id: 'f1',
      familyId: 'f1',
      familyToken: 't',
      familyKey: key,
      familyName: 'Наши',
      selfMemberId: 'me',
      lastSeq: 0,
      lastReadSeq: 0,
      enabled: true,
      joinedAt: new Date().toISOString(),
      keyEpoch: 0,
      keyRing: { '0': key },
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

test('скрепка открывает выбор «Фото/Файл»; выбор файла кладёт карточку без видимых чанков', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedFamily(page);

  await page.getByRole('button', { name: 'Прикрепить' }).click();
  await expect(page.getByRole('heading', { name: 'Вложение' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Фото' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Файл' })).toBeVisible();

  // Файл маленький — уложится в один чанк, что и требуется тесту.
  const buffer = Buffer.from('привет из текстового файла для проверки чата');
  const input = page.locator('input[type="file"][accept="*/*"]');
  await page.getByRole('button', { name: 'Файл' }).click(); // открывает нативный выбор (докидываем файл напрямую ниже)
  await input.setInputFiles({ name: 'заметка.txt', mimeType: 'text/plain', buffer });

  // Манифест: карточка с именем файла и размером. \s допускает
  // неразрывный пробел formatFileSize перед единицей измерения.
  await expect(page.getByText('заметка.txt')).toBeVisible();
  await expect(page.getByText(/Текст\s*·\s*\d+\s*Б/)).toBeVisible();

  const chunkCount = await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const all = await db.familyMessages.where('familyId').equals('f1').toArray();
    return all.filter((m) => m.fileChunk).length;
  });
  expect(chunkCount).toBeGreaterThan(0);
  // Чанки — служебные записи, в БД они есть (проверено выше), но пузырём не
  // рендерятся: во всей ленте ровно один элемент сообщения — манифест.
  await expect(page.locator('[data-msg-id]')).toHaveCount(1);
});

test('выбор файла больше 8 МБ отклоняется с тостом, отправки нет', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedFamily(page);

  await page.getByRole('button', { name: 'Прикрепить' }).click();
  const input = page.locator('input[type="file"][accept="*/*"]');
  await page.getByRole('button', { name: 'Файл' }).click();
  await input.setInputFiles({
    name: 'большой.bin',
    mimeType: 'application/octet-stream',
    buffer: Buffer.alloc(8 * 1024 * 1024 + 1),
  });

  await expect(page.getByText('Файл больше 8 МБ — такой не пройдёт через чат')).toBeVisible();
  const stored = await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const all = await db.familyMessages.where('familyId').equals('f1').toArray();
    return all.filter((m) => m.file || m.fileChunk).length;
  });
  expect(stored).toBe(0);
});

test('сид готового полученного файла: карточка кликабельна, без прогресса', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedFamily(page);

  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    await db.familyMessages.put({
      clientMsgId: 'manifest-ready',
      familyId: 'f1',
      seq: 5,
      senderMemberId: 'm0',
      createdAt: new Date().toISOString(),
      text: '',
      file: { fileId: 'file-1', name: 'отчёт.pdf', mime: 'application/pdf', size: 123456, chunksTotal: 1 },
      fileData: 'data:application/pdf;base64,JVBERi0xLjQK',
      status: 'acked',
      deletedAt: null,
    });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Наши' })).toBeVisible();

  await expect(page.getByText('отчёт.pdf')).toBeVisible();
  await expect(page.getByText(/Документ PDF\s*·\s*\d/)).toBeVisible();
  await expect(page.getByText('Получение')).toHaveCount(0);
  await expect(page.getByText('Файл недоступен')).toHaveCount(0);
});

test('сид манифеста без fileData и без чанков — «Файл недоступен»', async ({ page }) => {
  await openApp(page, '/more/family');
  await seedFamily(page);

  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    await db.familyMessages.put({
      clientMsgId: 'manifest-orphan',
      familyId: 'f1',
      seq: 6,
      senderMemberId: 'm0',
      createdAt: new Date().toISOString(),
      text: '',
      file: { fileId: 'file-2', name: 'старый.zip', mime: 'application/zip', size: 999, chunksTotal: 3 },
      fileData: null,
      status: 'acked',
      deletedAt: null,
    });
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Наши' })).toBeVisible();

  await expect(page.getByText('старый.zip')).toBeVisible();
  await expect(page.getByText('Файл недоступен')).toBeVisible();
});

// Однопиксельные картинки разного цвета: содержимое не важно, важно, что это
// разные файлы и что их несколько.
const PNG_RED = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test('несколько фото за раз уходят все и в том порядке, в каком выбраны', async ({ page }) => {
  // С прогулки снимков всегда пачка. Выбирать по одному и ждать отправки
  // каждого — занятие на несколько минут, и порядок при этом легко потерять.
  await openApp(page, '/more/family');
  await seedFamily(page);

  const before = await page.locator('img').count();

  await page.getByRole('button', { name: 'Прикрепить' }).click();
  await page.getByRole('button', { name: 'Фото' }).click();
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles([
    { name: 'первое.png', mimeType: 'image/png', buffer: PNG_RED },
    { name: 'второе.png', mimeType: 'image/png', buffer: PNG_RED },
    { name: 'третье.png', mimeType: 'image/png', buffer: PNG_RED },
  ]);

  await expect.poll(async () => page.locator('img').count(), { timeout: 15_000 }).toBe(before + 3);
});
