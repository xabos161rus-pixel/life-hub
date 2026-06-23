import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ command }) => ({
  // в dev — корень (удобнее для предпросмотра), в проде — путь GitHub Pages
  base: command === 'build' ? '/life-hub/' : '/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Life Hub',
        short_name: 'LifeHub',
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
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        navigateFallback: '/life-hub/index.html',
        // clientsClaim: после skipWaiting новый SW сразу перехватывает открытую
        // страницу → срабатывает controllerchange → кнопка «Обновить» реально
        // перезагружает (без этого SW активировался, но reload не происходил).
        clientsClaim: true,
        // Свой обработчик push/notificationclick поверх сгенерированного SW.
        importScripts: ['push-sw.js'],
      },
    }),
  ],
}))
