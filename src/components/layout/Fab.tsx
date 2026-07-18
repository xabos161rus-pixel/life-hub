import { Plus } from 'lucide-react';
import { usePomodoro } from '../../features/focus/PomodoroProvider';
import { useInstallBannerVisible } from '../../hooks/useInstallBanner';

interface Props {
  onClick: () => void;
  label?: string;
}

/** Плавающая кнопка добавления — над таб-баром справа, с акцентным свечением.
 *  Поднимается выше полоски мини-помодоро и install-баннера, чтобы их не перекрыть. */
export function Fab({ onClick, label = 'Добавить' }: Props) {
  const { active } = usePomodoro();
  const banner = useInstallBannerVisible();
  const bottom = banner
    ? 'bottom-[calc(env(safe-area-inset-bottom)+176px)]'
    : active
      ? 'bottom-[calc(env(safe-area-inset-bottom)+128px)]'
      : 'bottom-[calc(env(safe-area-inset-bottom)+80px)]';
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        backgroundImage: 'linear-gradient(140deg, var(--app-accent), var(--app-accent-2))',
      }}
      // right: на широких экранах держится у края центральной колонки max-w-lg
      className={`fixed right-[max(1.25rem,calc(50vw-16rem))] z-40 flex size-14 items-center justify-center rounded-full text-white shadow-[var(--shadow-accent)] transition-[transform,bottom] duration-200 active:scale-90 ${bottom}`}
    >
      <Plus size={26} strokeWidth={2.5} />
    </button>
  );
}
