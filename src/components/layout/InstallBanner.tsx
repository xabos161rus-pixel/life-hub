import { useEffect, useRef } from 'react';
import { Link } from 'react-router';
import { Share, X } from 'lucide-react';
import { dismissInstallBanner, useInstallBannerVisible } from '../../hooks/useInstallBanner';

/**
 * iOS не поддерживает beforeinstallprompt — показываем баннер с инструкцией,
 * пока приложение открыто во вкладке Safari, а не с экрана «Домой».
 * Логика видимости — в useInstallBanner (её же читает Fab).
 *
 * Баннер — обычный элемент flex-каркаса (не fixed) и стоит прямо над таб-баром:
 * так он занимает место сам, скролл-область ужимается на его высоту, и контент
 * физически не может уехать под него. Раньше он висел поверх на фиксированном
 * отступе, рассчитанном под ~96px высоты, — а при переносе текста в три строки
 * карточка вырастает до ~134px и накрывала последний блок и таб-бар.
 *
 * Занимаемое место отдаём в --install-banner-space (высота + нижний отступ +
 * зазор): её читает Fab, который остаётся плавающим и иначе не знает, на
 * сколько подняться. ResizeObserver — потому что высота зависит от переноса
 * текста, а он от ширины экрана и системного шрифта.
 */
/** mb-2 под баннером (8px) + зазор до плавающей кнопки (8px). */
const BANNER_GAPS = 16;

export function InstallBanner() {
  const visible = useInstallBannerVisible();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = document.documentElement;
    const el = ref.current;
    if (!visible || !el) {
      root.style.setProperty('--install-banner-space', '0px');
      return;
    }
    // getBoundingClientRect, а не entry.contentRect: последний отдаёт content-box
    // (без p-3 и рамки) — кнопка поднималась на ~28px меньше и всё равно
    // наезжала на баннер.
    const ro = new ResizeObserver(() => {
      const space = Math.round(el.getBoundingClientRect().height) + BANNER_GAPS;
      root.style.setProperty('--install-banner-space', `${space}px`);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.setProperty('--install-banner-space', '0px');
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      ref={ref}
      className="card mx-auto mb-2 flex w-[calc(100%-24px)] max-w-lg shrink-0 items-center gap-3 p-3"
    >
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
        onClick={dismissInstallBanner}
      >
        <X size={18} />
      </button>
    </div>
  );
}
