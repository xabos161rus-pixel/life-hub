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
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/life-hub/icons/icon-192.png',
      badge: '/life-hub/icons/icon-192.png',
      tag: data.taskId || undefined,
      data: { url: '/life-hub/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/life-hub/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
