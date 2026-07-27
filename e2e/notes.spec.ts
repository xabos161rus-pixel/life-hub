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

  test('поиск находит заметку, УБРАННУЮ в папку, из общего списка', async ({ page }) => {
    // Тест выше эту поломку не ловил: он ищет заметку, лежащую в корне, и
    // корневой список не пуст. А ветка пустого состояния проверяла именно его —
    // стоило разложить всё по папкам, и поиск по любому слову рисовал «Пока нет
    // заметок» вместо найденного.
    await newNote(page);
    await page.keyboard.type('Спрятанная заметка про якорь');
    await page.waitForTimeout(900);
    await openApp(page, '/notes');

    await page.getByRole('button', { name: 'Новая папка' }).click();
    await page.getByPlaceholder('Например, «Работа»').fill('Архив');
    await page.getByRole('button', { name: 'Создать папку' }).click();

    // Долгим нажатием отправляем единственную заметку в папку — корень пустеет.
    const row = page.getByText('Спрятанная заметка про якорь').first();
    await row.hover();
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.getByRole('button', { name: /Архив/ }).click();
    await expect(page.getByText('Пока нет заметок')).toBeVisible();

    // И ищем её из корня.
    await page.getByPlaceholder(/Поиск/i).fill('якорь');
    await expect(page.getByText('Пока нет заметок')).toHaveCount(0);
    await expect(page.getByText('Спрятанная заметка про якорь')).toBeVisible();
  });

  test('стрелка «Назад» на экране «Куда перенести?» возвращает к списку', async ({ page }) => {
    // Экран переноса — состояние внутри /notes, а не отдельный маршрут. Ссылка
    // на собственный адрес компонент не размонтирует: стрелка выглядела рабочей
    // и не делала ничего, а «Отмена» лежит под длинным списком папок.
    await newNote(page);
    await page.keyboard.type('Заметка для переноса');
    await page.waitForTimeout(900);
    await openApp(page, '/notes');

    const row = page.getByText('Заметка для переноса').first();
    await row.hover();
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.getByRole('heading', { name: 'Куда перенести?' })).toBeVisible();

    await page.getByRole('button', { name: 'Назад' }).click();
    await expect(page.getByRole('heading', { name: 'Куда перенести?' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Заметки' })).toBeVisible();
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

test.describe('редактор', () => {
  test('чек-лист: создаётся, отмечается тапом, переживает перезагрузку', async ({ page }) => {
    // Список дел — главное, чего в редакторе не было. Проверяем весь путь:
    // кнопка, ввод, отметка галочкой и сохранение состояния.
    await newNote(page);
    await page.keyboard.type('Покупки');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Список задач' }).click();
    await page.keyboard.type('Молоко');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Хлеб');
    await expect(page.locator('.note-editor ul.cl > li')).toHaveCount(2);

    // Тап по галочке первого пункта — по левому краю, где она нарисована.
    const first = page.locator('.note-editor ul.cl > li').first();
    const box = (await first.boundingBox())!;
    await page.mouse.click(box.x + 10, box.y + box.height / 2);
    await expect(first).toHaveAttribute('data-done', '1');

    // Отметка обязана пережить сохранение: она в атрибуте, а санитайзер режет
    // всё, чего нет в списке разрешённых.
    await page.waitForTimeout(900);
    await page.reload();
    await page.waitForTimeout(900);
    await expect(page.locator('.note-editor ul.cl > li[data-done="1"]')).toHaveCount(1);
  });

  test('тап по тексту пункта ставит каретку, а не отмечает', async ({ page }) => {
    // Зона галочки узкая намеренно: шире — и она начнёт перехватывать тапы по
    // тексту, когда человек хочет просто поправить слово.
    await newNote(page);
    await page.keyboard.type('Дела');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Список задач' }).click();
    await page.keyboard.type('Позвонить в банк');
    const li = page.locator('.note-editor ul.cl > li').first();
    const box = (await li.boundingBox())!;
    await page.mouse.click(box.x + box.width - 12, box.y + box.height / 2);
    await expect(li).not.toHaveAttribute('data-done', '1');
  });

  test('подзаголовок и цитата включаются и выключаются', async ({ page }) => {
    // Без повторного нажатия из блочного формата нельзя выйти, не удаляя
    // строку — это и была бы ловушка.
    await newNote(page);
    await page.keyboard.type('Заметка');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Раздел');
    await page.getByRole('button', { name: 'Подзаголовок' }).click();
    await expect(page.locator('.note-editor h2')).toHaveCount(1);
    await page.getByRole('button', { name: 'Подзаголовок' }).click();
    await expect(page.locator('.note-editor h2')).toHaveCount(0);

    await page.getByRole('button', { name: 'Цитата' }).click();
    await expect(page.locator('.note-editor blockquote')).toHaveCount(1);
    await page.getByRole('button', { name: 'Цитата' }).click();
    await expect(page.locator('.note-editor blockquote')).toHaveCount(0);
  });

  test('зачёркнутый текст сохраняется', async ({ page }) => {
    await newNote(page);
    await page.keyboard.type('Заголовок');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Отменённый пункт');
    await page.keyboard.press('Shift+Home');
    await page.getByRole('button', { name: 'Зачёркнутый' }).click();
    await page.waitForTimeout(900);
    await page.reload();
    await page.waitForTimeout(900);
    await expect(page.locator('.note-editor s, .note-editor strike')).toHaveCount(1);
  });

  test('кнопка списка не уносит каретку в начало строки', async ({ page }) => {
    // execCommand пересобирает блок и ставит каретку в НАЧАЛО нового
    // контейнера. Из-за этого «написал строку → нажал список → продолжил
    // набор» дописывало текст ПЕРЕД уже написанным: «Покупки» + «молоко»
    // давало «МолокоПокупки» одним пунктом.
    await newNote(page);
    await page.keyboard.type('Заголовок');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Покупки');
    await page.getByRole('button', { name: 'Маркированный список' }).click();
    await page.keyboard.type(' на неделю');
    const item = await page.locator('.note-editor li').first().textContent();
    expect(item).toBe('Покупки на неделю');
  });

  test('второй пункт списка начинается с заглавной буквы', async ({ page }) => {
    // Клавиатура iOS капитализирует по пунктуации: заглавная идёт после точки.
    // В списке точек нет — люди пишут пункты без них, — и второй пункт начинался
    // со строчной, хотя каждый пункт это отдельное предложение.
    await newNote(page);
    await page.keyboard.type('Покупки');
    await page.keyboard.press('Enter'); // заголовок остаётся заголовком
    await page.getByRole('button', { name: 'Маркированный список' }).click();
    await page.keyboard.type('молоко');
    await page.keyboard.press('Enter');
    await page.keyboard.type('хлеб');
    await page.keyboard.press('Enter');
    await page.keyboard.type('сыр');

    const items = await page.locator('.note-editor li').allTextContents();
    expect(items).toEqual(['Молоко', 'Хлеб', 'Сыр']);
  });

  test('регистр в СЕРЕДИНЕ строки не трогаем', async ({ page }) => {
    // Обратная сторона: подниматься должна только первая буква строки. Иначе
    // «и т.д.» превратилось бы в «И т.Д.», а это хуже, чем строчная в начале.
    await newNote(page);
    await page.keyboard.type('Заголовок');
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Маркированный список' }).click();
    await page.keyboard.type('купить хлеб и молоко');
    const item = await page.locator('.note-editor li').first().textContent();
    expect(item).toBe('Купить хлеб и молоко');
  });

  test('первая строка заметки тоже с заглавной', async ({ page }) => {
    await newNote(page);
    await page.keyboard.type('заголовок заметки');
    await expect(page.locator('.note-editor')).toContainText('Заголовок заметки');
  });

  test('вставка из веба не приносит чужие классы', async ({ page }) => {
    // В конфиге санитайзера стоял ALLOWED_CLASSES — такой опции у DOMPurify
    // нет вовсе (она из sanitize-html), и незнакомые ключи он молча
    // игнорирует. То есть class проходил целиком, а приложение на Tailwind с
    // глобальными утилитами: фрагмент с class="hidden" давал сохранённый, но
    // невидимый текст, class="fixed inset-0 z-50" — блок поверх экрана.
    await newNote(page);
    await page.keyboard.type('Заголовок');
    await paste(
      page,
      'вставленный текст',
      '<p class="hidden">вставленный текст</p><div class="fixed inset-0 z-50">поверх</div>',
    );

    const html = await page.locator('.note-editor').innerHTML();
    expect(html, `чужие классы уцелели: ${html}`).not.toContain('hidden');
    expect(html).not.toContain('fixed');

    // И текст при этом видно — санитайз чистит атрибут, а не содержимое.
    await expect(page.getByText('вставленный текст')).toBeVisible();
  });

  test('класс чек-листа санитайз переживает', async ({ page }) => {
    // Обратная сторона: единственный класс, который нужен приложению, обязан
    // остаться — иначе чек-лист после сохранения перестанет быть чек-листом.
    await newNote(page);
    await page.keyboard.type('Список');
    await page.getByRole('button', { name: 'Список задач' }).click();
    await page.keyboard.type('пункт');
    await page.waitForTimeout(900);
    await page.reload();
    await expect(page.locator('.note-editor ul.cl')).toHaveCount(1);
  });

  test('панель форматирования не выталкивает страницу вбок', async ({ page }) => {
    // Кнопок стало девять, в ширину телефона они не помещаются. Прокручиваться
    // должна панель, а не страница.
    await newNote(page);
    const scrollable = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(scrollable).toBe(false);
  });
});
