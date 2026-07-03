// Подключается в сгенерированный Workbox-SW через workbox.importScripts.
// Показывает уведомление по входящему пушу и фокусирует приложение по клику.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = data.title || 'Напоминание';
  // Звонок: renotify перезванивает одной карточкой на каждый пуш серии
  // «дозвона», requireInteraction держит её на экране до ответа (Android;
  // iOS оба флага игнорирует — там серия сама складывается в баннеры со звуком).
  const isCall = !!data.call;
  const tag = data.taskId || data.tag || undefined;
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/life-hub/icons/icon-192.png',
      badge: '/life-hub/icons/icon-192.png',
      tag: tag,
      renotify: isCall && !!tag, // renotify без tag — TypeError, уведомление не показалось бы вовсе
      requireInteraction: isCall,
      data: { url: data.family ? '/life-hub/more/family' + (data.familyId ? '?g=' + data.familyId : '') : '/life-hub/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/life-hub/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          // Уже открытое окно: просим приложение перейти на нужный экран (чат
          // конкретной группы) без перезагрузки и наводим фокус. Раньше делался
          // только focus() — поэтому открывалось приложение, а не сам чат.
          try {
            c.postMessage({ type: 'open-url', url: url });
          } catch (e) {
            /* клиент не принял сообщение */
          }
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
