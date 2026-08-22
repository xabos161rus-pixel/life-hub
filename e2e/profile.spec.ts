import { test, expect, openApp } from './fixtures';

// Профиль: карточка о себе, а не анкета.
//
// История трёх дефектов, которые здесь закрыты:
// 1. Дата рождения показывалась нативным полем в формате СИСТЕМЫ, а не языка
//    приложения — «06/29/1998» вместо «29 июня 1998». Владелец приложения
//    посмотрел на это и спросил, что за дата.
// 2. Имя, рост и вес сохранялись по кнопке, а пол на том же экране — сразу.
//    Две разные механики на одном экране, и человек не может знать, какая где.
// 3. Рост и вес лежали числами, из которых ничего не следовало.

test('дата рождения читается словами, а рядом — возраст', async ({ page }) => {
  await openApp(page, '/home/profile');
  await page.getByLabel('Дата рождения').fill('1998-06-29');

  // Нативное поле остаётся (системный календарь удобнее самодельного), но
  // рядом появляется человеческая подпись.
  await expect(page.getByText('29 июня 1998')).toBeVisible();
  // Возраст — то, ради чего дату и вводят.
  await expect(page.getByText(/\d+ (год|года|лет)/)).toBeVisible();
});

test('изменения сохраняются сами, без кнопки', async ({ page }) => {
  await openApp(page, '/home/profile');
  // Кнопки «Сохранить» на экране больше нет вовсе.
  await expect(page.getByRole('button', { name: 'Сохранить', exact: true })).toHaveCount(0);

  await page.getByLabel('Имя').fill('Влад');
  // Отметка появляется в дереве только после записи — по ней и ждём, иначе
  // проверка проскакивает вперёд самой записи.
  await expect(page.getByText('Сохранено')).toBeVisible();

  // И переживают перезагрузку — то есть действительно записались.
  await page.reload();
  await expect(page.getByLabel('Имя')).toHaveValue('Влад');
});

test('рост и вес превращаются в индекс массы тела', async ({ page }) => {
  await openApp(page, '/home/profile');
  await page.getByLabel('Рост, см').fill('178');
  await page.getByLabel('Вес, кг').fill('70');

  const bmi = page.getByText('Индекс массы тела');
  await expect(bmi).toBeVisible();
  await expect(page.getByText('22,1')).toBeVisible();
  await expect(page.getByText('норма')).toBeVisible();

  // Пока данных не хватает — строки нет: пустой показатель хуже отсутствующего.
  await page.getByLabel('Вес, кг').fill('');
  await expect(bmi).toHaveCount(0);
});

test('шапка показывает, кто это, одной строкой', async ({ page }) => {
  await openApp(page, '/home/profile');
  await page.getByLabel('Имя').fill('Влад');
  await page.getByLabel('Дата рождения').fill('1998-06-29');
  await page.getByLabel('Рост, см').fill('178');
  await page.getByLabel('Вес, кг').fill('70');

  // Возраст вместо даты: сколько человеку лет, понятнее, чем когда он родился.
  await expect(page.getByText(/\d+ лет · 178 см · 70 кг/)).toBeVisible();
});
