import { useSyncExternalStore } from 'react';
import { isTouch } from '../lib/platform';

const DISMISS_KEY = 'life-hub-install-dismissed';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // старый Safari-флаг
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/* Видимость install-баннера как крошечный внешний стор: на неё подписаны и сам
   баннер, и Fab (поднимается выше, чтобы не наезжать на карточку). */
const listeners = new Set<() => void>();

function bannerVisible(): boolean {
  // Инструкция «Поделиться → На экран “Домой”» — про Safari на iPhone/iPad.
  // На Mac/Windows она неверна, а риска потерять данные меньше — не показываем.
  return isTouch && !isStandalone() && localStorage.getItem(DISMISS_KEY) !== '1';
}

/** Скрыть баннер навсегда и оповестить подписчиков (баннер + Fab). */
export function dismissInstallBanner(): void {
  localStorage.setItem(DISMISS_KEY, '1');
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Видимость install-баннера (для баннера, Fab и других плавающих элементов). */
export function useInstallBannerVisible(): boolean {
  return useSyncExternalStore(subscribe, bannerVisible);
}
