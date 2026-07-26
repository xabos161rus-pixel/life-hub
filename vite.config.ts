import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Метка сборки в Настройках: на iOS обновление PWA иногда подхватывается со
// второго запуска, и без неё невозможно отличить настоящий баг от старой
// закэшированной версии. Живёт в <meta> внутри index.html, а НЕ в JS через
// define: вшитая в бандл метка меняла бы контент-хэш assets/index-*.js на
// каждой сборке, а cron-сторож в воркере следит именно за этим хэшем и слал
// бы пуш «вышло обновление» после пересборки без единой правки кода.
const BUILD_ID = new Date().toISOString().replace('T', ' ').slice(0, 16);

export default defineConfig(({ command }) => ({
  // в dev — корень (удобнее для предпросмотра), в проде — путь GitHub Pages
  base: command === 'build' ? '/life-hub/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'build-id-meta',
      transformIndexHtml: () => [
        { tag: 'meta', attrs: { name: 'build-id', content: BUILD_ID }, injectTo: 'head' as const },
      ],
    },
    VitePWA({
      // autoUpdate (а не 'prompt'): на iOS-PWA ручное «Обновить» ненадёжно — юзер
      // застревал на старом кэше и не видел задеплоенных фиксов. Теперь новый SW
      // активируется сам (skipWaiting + clientsClaim) и страница перезагружается
      // на свежую версию без участия пользователя.
      registerType: 'autoUpdate',
      manifest: {
        name: 'LifeHearth',
        short_name: 'LifeHearth',
        description: 'Личный центр управления жизнью',
        lang: 'ru',
        start_url: '/life-hub/',
        scope: '/life-hub/',
        display: 'standalone',
        orientation: 'portrait',
        theme_color: '#1d1d27',
        background_color: '#1d1d27',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // Приём «Поделиться» (Android/десктоп Chromium; iOS WebKit это не
        // поддерживает — там вход в /share идёт через ярлык Shortcuts и кнопку
        // «Вставить из буфера»). GET-навигация ловится SPA-роутером на /share.
        share_target: {
          action: '/life-hub/share',
          method: 'GET',
          params: { title: 'title', text: 'text', url: 'url' },
        },
        // Пункты по долгому нажатию на иконку (это WebKit поддерживает и на iOS).
        shortcuts: [
          { name: 'Быстрый захват', url: '/life-hub/share' },
          { name: 'Новая заметка', url: '/life-hub/notes/new' },
          { name: 'Новая задача', url: '/life-hub/tasks' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/life-hub/index.html',
        // skipWaiting+clientsClaim: новый SW не ждёт в waiting, а сразу
        // активируется и перехватывает открытую страницу → controllerchange →
        // авто-reload на свежую версию (иначе обновление откладывалось до
        // полного закрытия всех вкладок/иконки PWA — на iOS почти никогда).
        skipWaiting: true,
        clientsClaim: true,
        // Свой обработчик push/notificationclick поверх сгенерированного SW.
        importScripts: ['push-sw.js'],
      },
    }),
  ],
}))
