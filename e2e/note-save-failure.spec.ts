import { expect } from '@playwright/test';
import { openApp, test } from './fixtures';

// Что происходит, когда сохранение заметки не удалось.
//
// Флаг «есть несохранённое» снимался ДО записи. Значит упавшая запись не
// повторялась никогда: текст оставался на экране, в базу не попадал, и человеку
// об этом не говорили ни слова. Заметку теряла первая же нехватка места.

test('упавшее сохранение видно и повторяется, а не теряется молча', async ({ page }) => {
  await openApp(page, '/notes/new');

  // Ломаем запись в базу: следующая попытка сохранения упадёт.
  await page.evaluate(async () => {
    const { db } = await import('/src/db/db.ts');
    const w = window as unknown as { __restoreNotes: () => void };
    const orig = db.notes.add.bind(db.notes);
    const origPut = db.notes.put.bind(db.notes);
    db.notes.add = (() => Promise.reject(new Error('нет места'))) as typeof db.notes.add;
    db.notes.put = (() => Promise.reject(new Error('нет места'))) as typeof db.notes.put;
    w.__restoreNotes = () => {
      db.notes.add = orig;
      db.notes.put = origPut;
    };
  });

  const editor = page.locator('.note-editor');
  await editor.click();
  await editor.pressSequentially('Важная мысль, которую нельзя потерять');

  // Человеку сказали, что не сохранилось.
  await expect(page.getByText(/Не удалось сохранить заметку/)).toBeVisible({ timeout: 15_000 });
  // И текст на экране цел.
  await expect(editor).toContainText('Важная мысль, которую нельзя потерять');

  // База снова работает. Человек больше ничего не печатает — просто уходит с
  // экрана. Здесь и проверяется главное: заметка помнит, что не сохранена, и
  // уходя записывается. Со снятым раньше времени флагом текст исчез бы
  // насовсем, причём молча.
  await page.evaluate(() => (window as unknown as { __restoreNotes: () => void }).__restoreNotes());
  await page.getByRole('link', { name: 'Назад' }).click();

  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const { db } = await import('/src/db/db.ts');
          const rows = await db.notes.toArray();
          return rows.some((n) => (n.content ?? '').includes('Важная мысль'));
        }),
      { timeout: 15_000 },
    )
    .toBe(true);
});
