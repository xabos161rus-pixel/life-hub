import { test, expect, openApp } from './fixtures';
import type { Page } from '@playwright/test';

// Раздел заметок целиком: структура редактора, вставка, форматирование, папки.
//
// Заметка — один contenteditable, а не «поле заголовка + поле текста».
// Заголовок здесь это ведущий «голый» текст: стиль задаёт база .note-editor, а
// любой блочный тег его сбрасывает. Пока человек печатает руками, инвариант
// держится сам; вставка из буфера приносит чужую разметку и ломала его.

async function newNote(page: Page) {
  await openApp(page, '/notes/new');
  await page.locator('.note-editor').click();
}

/** Вставка через синтетическое событие: реальный буфер обмена в headless
 *  недоступен, а обработчик приложения слушает именно paste. */
async function paste(page: Page, text: string, html?: string) {
  await page.evaluate(
    ({ text, html }) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      if (html) dt.setData('text/html', html);
      document
        .querySelector('.note-editor')!
        .dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    },
    { text, html },
  );
  await page.waitForTimeout(200);
}

/** Кегль первой строки. Заголовок крупный, тело — обычное. */
async function firstLineSize(page: Page) {
  return page.evaluate(() => {
    const el = document.querySelector('.note-editor')!;
    const n = el.firstChild;
    const probe = n && n.nodeType === Node.ELEMENT_NODE ? (n as Element) : el;
    return parseFloat(getComputedStyle(probe).fontSize);
  });
}

test.describe('заголовок заметки', () => {
  test('набранный руками — крупный', async ({ page }) => {
    await newNote(page);
    await page.keyboard.type('Заголовок руками');
    expect(await firstLineSize(page)).toBeGreaterThan(20);
  });

  // Каждый источник кладёт в буфер свою разметку, и раньше половина из них
  // молча превращала заголовок в обычный текст.
  const SOURCES: [string, string | undefined][] = [
    ['мессенджер (только текст)', undefined],
    ['браузер', '<div>Заголовок из буфера</div>'],
    ['редактор документов', '<p>Заголовок из буфера</p>'],
    ['мелкий шрифт в источнике', '<span style="font-size:11px">Заголовок из буфера</span>'],
    ['несколько строк', '<div>Заголовок из буфера</div><div>Вторая строка</div>'],
  ];
  for (const [label, html] of SOURCES) {
    test(`вставка: ${label} — тоже крупный`, async ({ page }) => {
      await newNote(page);
      await paste(page, 'Заголовок из буфера', html);
      expect(await firstLineSize(page)).toBeGreaterThan(20);
    });
  }

  test('вставка нескольких строк оставляет тело обычным', async ({ page }) => {
    // Обратная проверка: развернуть ведущий блок — не значит развернуть всё.
    await newNote(page);
    await paste(page, 'Заголовок\nВторая', '<div>Заголовок</div><div>Вторая строка</div>');
    const bodySize = await page.evaluate(() => {
      const el = document.querySelector('.note-editor')!;
      const body = el.querySelector('div');
      return body ? parseFloat(getComputedStyle(body).fontSize) : null;
    });
    expect(bodySize).toBeLessThan(20);
  });

  test('заметка со списка не ломается', async ({ page }) => {
    // Если заметка начинается со списка, заголовка у неё просто нет —
    // вытаскивать первый пункт наружу ради заголовка нельзя.
    await newNote(page);
    await paste(page, 'Первый', '<ul><li>Первый</li><li>Второй</li></ul>');
    const items = await page.locator('.note-editor li').count();
    expect(items).toBe(2);
  });
});

test.describe('папки', () => {
  test('создать папку, перенести заметку, вернуться в общий список', async ({ page }) => {
    // Полный путь человека: у него уже есть заметка, он заводит папку и
    // раскладывает. Проверяем именно связку, а не отдельные экраны.
    await newNote(page);
    await page.keyboard.type('Договор с поставщиком');
    await page.waitForTimeout(900); // автосохранение
    await openApp(page, '/notes');

    await page.getByRole('button', { name: 'Новая папка' }).click();
    await page.getByPlaceholder('Например, «Работа»').fill('Работа');
    await page.getByRole('button', { name: 'Создать папку' }).click();
    await expect(page.getByText('Работа')).toBeVisible();

    // Долгое нажатие по заметке — перенос.
    const row = page.getByText('Договор с поставщиком').first();
    await row.hover();
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.getByText('Куда перенести?')).toBeVisible();

    await page.getByRole('button', { name: /Работа/ }).click();
    await expect(page.getByText('Куда перенести?')).toHaveCount(0);

    // Заметка ушла из корня в папку.
    await expect(page.getByText('Договор с поставщиком')).toHaveCount(0);
    await page.getByRole('button', { name: /Работа/ }).click();
    await expect(page.getByText('Договор с поставщиком')).toBeVisible();
  });

  test('поиск ищет по всем заметкам, а не по открытой папке', async ({ page }) => {
    // Поиск, молча ограниченный невидимой папкой, читается как «заметка
    // пропала» — это худшее, что может сделать раздел с заметками.
    await newNote(page);
    await page.keyboard.type('Уникальное слово фонарь');
    await page.waitForTimeout(900);
    await openApp(page, '/notes');
    await page.getByPlaceholder(/Поиск/i).fill('фонарь');
    await expect(page.getByText('Уникальное слово фонарь')).toBeVisible();
  });

  test('удаление папки не удаляет заметки', async ({ page }) => {
    await newNote(page);
    await page.keyboard.type('Важная заметка внутри папки');
    await page.waitForTimeout(900);
    await openApp(page, '/notes');
    await page.getByRole('button', { name: 'Новая папка' }).click();
    await page.getByPlaceholder('Например, «Работа»').fill('Временная');
    await page.getByRole('button', { name: 'Создать папку' }).click();

    const row = page.getByText('Важная заметка внутри папки').first();
    await row.hover();
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.getByRole('button', { name: /Временная/ }).click();

    page.once('dialog', (d) => void d.accept());
    await page.getByRole('button', { name: /Временная/ }).click();
    await page.getByRole('button', { name: 'Изменить' }).click();
    await page.getByRole('button', { name: 'Удалить папку' }).click();
    await page.waitForTimeout(500);

    // Заметка вернулась в общий список, а не исчезла вместе с папкой.
    await expect(page.getByText('Важная заметка внутри папки')).toBeVisible();
  });
});
