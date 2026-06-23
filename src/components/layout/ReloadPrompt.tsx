import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const CHECK_INTERVAL = 15 * 60 * 1000; // проверять обновление раз в 15 мин

/**
 * Тихое авто-обновление PWA (registerType: 'autoUpdate'). Новый service worker
 * активируется сам (skipWaiting + clientsClaim), а при смене контроллера
 * страница один раз перезагружается на свежую версию. Кнопки «Обновить» больше
 * нет — на iOS-PWA она была ненадёжной и юзер застревал на старом кэше. UI не
 * рендерит; периодически дёргает registration.update(), чтобы быстро подхватить
 * свежий билд (iOS сам проверяет sw.js редко).
 */
export function ReloadPrompt() {
  useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => registration.update().catch(() => {});
      check(); // сразу при запуске
      setInterval(check, CHECK_INTERVAL);
      // при возврате в приложение (из фона/другой вкладки) — проверить снова
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });

  // Когда новый SW перехватывает страницу (controllerchange) — перезагружаемся
  // на свежую версию. Гард hadController: при ПЕРВОЙ установке SW контроллер
  // тоже меняется (null → SW), но контент уже свежий — лишний reload не нужен.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let hadController = !!navigator.serviceWorker.controller;
    let refreshing = false;
    const onChange = () => {
      if (!hadController) {
        hadController = true; // первая установка — без перезагрузки
        return;
      }
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    return () => navigator.serviceWorker.removeEventListener('controllerchange', onChange);
  }, []);

  return null;
}
