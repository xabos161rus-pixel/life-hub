import { useState } from 'react';
import { Link } from 'react-router';
import { Share, X } from 'lucide-react';

const DISMISS_KEY = 'life-hub-install-dismissed';

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // старый Safari-флаг
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/**
 * iOS не поддерживает beforeinstallprompt — показываем баннер с инструкцией,
 * пока приложение открыто во вкладке Safari, а не с экрана «Домой».
 */
export function InstallBanner() {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === '1',
  );

  if (dismissed || isStandalone()) return null;

  return (
    <div className="card fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+78px)] z-30 mx-auto flex max-w-lg items-center gap-3 p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
        <Share size={18} />
      </span>
      <Link to="/more/settings/install" className="min-w-0 flex-1 text-sm">
        <span className="font-semibold">Установите на экран «Домой»</span>
        <span className="block text-muted">
          Иначе данные могут не сохраниться. Как это сделать →
        </span>
      </Link>
      <button
        aria-label="Скрыть"
        className="shrink-0 p-1 text-muted"
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, '1');
          setDismissed(true);
        }}
      >
        <X size={18} />
      </button>
    </div>
  );
}
