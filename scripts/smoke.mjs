// Smoke-тест: регресс основных экранов + сквозной сценарий раздела ИИ.
// Запуск: npm run smoke (поднимает preview на 4173 и гоняет Chromium).
// Именно он поймал баг с лишним пустым чатом при старте — в проекте это
// единственная автоматическая проверка, гонять её перед каждым коммитом,
// который трогает db.ts, sync.ts или index.css.
import { chromium } from 'playwright';

const BASE = 'http://localhost:4173/life-hub';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const p = await b.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
p.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0,160)}`); });

async function dismissOnboarding() {
  const skip = p.getByRole('button', { name: 'Пропустить' });
  if (await skip.isVisible().catch(() => false)) {
    await skip.click();
    await p.waitForTimeout(500);
  }
}

async function visit(path, expectText) {
  await p.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  const body = await p.textContent('body');
  const ok = body.includes(expectText);
  console.log(`${ok ? '✓' : '✗'} ${path.padEnd(22)} ждали «${expectText}»`);
  return ok;
}

// Регресс-чеклист: основные экраны рабочего приложения
await p.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await dismissOnboarding();
let pass = true;
pass &= await visit('/', 'Сегодня');
pass &= await visit('/tasks', 'Задачи');
pass &= await visit('/notes', 'Заметки');
pass &= await visit('/more', 'Ещё');
pass &= await visit('/more/focus', 'Фокус');
pass &= await visit('/more/settings', 'Раздел «ИИ»');

// Раздел ИИ скрыт по умолчанию
await p.goto(`${BASE}/more`, { waitUntil: 'networkidle' });
const hiddenOk = !(await p.textContent('body')).includes('Чат с языковой моделью');
console.log(`${hiddenOk ? '✓' : '✗'} раздел ИИ скрыт при выключенном флаге`);
pass &= hiddenOk;

// Включаем флаг в Настройках
await p.goto(`${BASE}/more/settings`, { waitUntil: 'networkidle' });
await p.getByRole('button', { name: 'Показать', exact: true }).click();
await p.waitForTimeout(400);
await p.goto(`${BASE}/more`, { waitUntil: 'networkidle' });
const shownOk = (await p.textContent('body')).includes('Чат с языковой моделью');
console.log(`${shownOk ? '✓' : '✗'} раздел ИИ появился после включения флага`);
pass &= shownOk;

// Экран чата: открывается, есть композер
await p.goto(`${BASE}/more/ai`, { waitUntil: 'networkidle' });
await p.waitForTimeout(500);
const chatOk = await p.getByPlaceholder('Сообщение…').isVisible();
console.log(`${chatOk ? '✓' : '✗'} экран чата открылся, поле ввода на месте`);
pass &= chatOk;

// Отправка: воркер недоступен локально → ждём пузырь с понятной ошибкой,
// а не белый экран. Это и есть проверка обработки ошибок.
await p.getByPlaceholder('Сообщение…').fill('Проверка связи');
await p.getByRole('button', { name: 'Отправить' }).click();
await p.waitForTimeout(2500);
const body = await p.textContent('body');
const userEcho = body.includes('Проверка связи');
const errShown = /Включите синхронизацию|Нет связи|Сервер не признал/.test(body);
console.log(`${userEcho ? '✓' : '✗'} вопрос отрисован в ленте`);
console.log(`${errShown ? '✓' : '✗'} ошибка показана человеческим текстом`);
pass &= userEcho && errShown;

// История переживает перезагрузку
await p.reload({ waitUntil: 'networkidle' });
await p.waitForTimeout(600);
const persisted = (await p.textContent('body')).includes('Проверка связи');
console.log(`${persisted ? '✓' : '✗'} история на месте после перезагрузки`);
pass &= persisted;

await p.screenshot({ path: 'dist/smoke-ai-chat.png', fullPage: false });
await b.close();

const real = errors.filter((e) => !/Failed to load resource|net::ERR|workers\.dev|Manifest|icon/i.test(e));
if (real.length) { console.log('\nОШИБКИ В КОНСОЛИ:'); real.slice(0,8).forEach((e) => console.log(' ', e)); }
console.log(pass && !real.length ? '\nSMOKE: ВСЁ ЗЕЛЁНОЕ' : '\nSMOKE: ЕСТЬ ПРОБЛЕМЫ');
