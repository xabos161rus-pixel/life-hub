import { defineConfig, devices } from '@playwright/test';

// Браузерные тесты. Отдельно от vitest намеренно: vitest проверяет чистые
// функции и работает за секунды, а сюда попадает то, что видно только в
// настоящем движке — вёрстка, жесты, IndexedDB, service worker.
//
// Чем это может упасть на чужой машине: браузер здесь предустановлен
// (PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers), а на новой понадобится
// `npx playwright install chromium`.
export default defineConfig({
  testDir: './e2e',
  // Дев-сервер отдаёт приложение по '/', а боевая сборка — по '/life-hub/'
  // (vite.config.ts: base зависит от command). Обратиться сюда по боевому пути
  // — значит попасть на несуществующий маршрут: оболочка отрисуется, а
  // содержимое экрана нет. Так и вышло при первом прогоне, и тесты этого не
  // заметили, потому что проверяли «#root не пуст».
  use: {
    baseURL: 'http://127.0.0.1:5199/',
    // Размер iPhone 14 Pro: приложение мобильное, и почти все дефекты вёрстки,
    // которые ловились раньше, проявлялись именно на узком экране.
    ...devices['iPhone 14 Pro'],
    // Профиль устройства тянет за собой WebKit, а установлен здесь Chromium.
    // Нам нужна геометрия узкого экрана и тач, а не именно движок Safari.
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  // Один браузер: гоняем не совместимость, а собственные регрессии.
  projects: [{ name: 'mobile-chromium' }],
  webServer: {
    command: 'npm run dev -- --port 5199 --strictPort',
    url: 'http://127.0.0.1:5199/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  // Тесты пишут в одну и ту же IndexedDB через отдельные контексты, но
  // параллельные вкладки на слабой машине дают ложные таймауты.
  workers: process.env.CI ? 1 : 2,
  reporter: process.env.CI ? 'line' : 'list',
  expect: { timeout: 7000 },
});
