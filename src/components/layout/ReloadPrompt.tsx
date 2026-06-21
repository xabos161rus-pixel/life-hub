import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw } from 'lucide-react';

const CHECK_INTERVAL = 20 * 60 * 1000; // раз в 20 мин проверять обновление

/**
 * Баннер «Доступна новая версия» с кнопкой «Обновить». Решает проблему iOS-PWA,
 * где установленное приложение не обновлялось без ручного закрытия/открытия.
 * Теперь новая версия предлагается явной кнопкой (skipWaiting + reload).
 */
export function ReloadPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
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

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+78px)] z-40 flex items-center gap-3 rounded-2xl border border-accent/40 bg-elevated p-3 shadow-[var(--shadow-pop)]">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
        <RefreshCw size={18} />
      </span>
      <div className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">Доступна новая версия</span>
        <span className="block text-muted">Обновите, чтобы получить последние изменения</span>
      </div>
      <button
        onClick={() => updateServiceWorker(true)}
        className="shrink-0 rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white active:opacity-80"
      >
        Обновить
      </button>
      <button
        aria-label="Позже"
        className="shrink-0 px-1 text-sm text-muted"
        onClick={() => setNeedRefresh(false)}
      >
        Позже
      </button>
    </div>
  );
}
