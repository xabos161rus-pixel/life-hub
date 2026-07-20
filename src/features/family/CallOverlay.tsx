import { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Mic, MicOff, Volume2, Headphones, Lock } from 'lucide-react';
import { callManager, type CallSnapshot } from '../../lib/family/familyCall';
import { CallGuard } from './CallGuard';

/** Через сколько заблокировать экран после того, как звонок ушёл «к уху». */
const LOCK_AFTER_CONNECT_MS = 1800;
/** Пауза бездействия после разблокировки/нажатия, после которой снова блок.
 *  Держим коротким: чем меньше открытое окно, тем меньше шанс, что вернув
 *  телефон к уху, щека заденет кнопку до повторной блокировки. */
const RELOCK_IDLE_MS = 4000;

function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function statusText(snap: CallSnapshot): string {
  switch (snap.status) {
    case 'outgoing':
      return 'Вызов…';
    case 'incoming':
      return 'Входящий звонок';
    case 'connecting':
      return 'Соединение…';
    case 'active':
      return 'На связи';
    case 'ended':
      return snap.endReason ?? 'Звонок завершён';
    default:
      return '';
  }
}

export function CallOverlay({ snap }: { snap: CallSnapshot }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (snap.status !== 'active') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [snap.status]);

  const incoming = snap.status === 'incoming';
  const ended = snap.status === 'ended';
  const active = snap.status === 'active';
  // «К уху» = активный звонок с маршрутом на слуховой динамик (не громкая связь).
  // Именно тогда телефон у щеки и нужна защита от случайных нажатий.
  const earpiece = active && !snap.speakerOn;
  const initial = (snap.peerName || '?').slice(0, 1).toUpperCase();

  // --- Защита от нажатий щекой ---
  const [locked, setLocked] = useState(false);
  const lockTimer = useRef<number | undefined>(undefined);
  // Свежий earpiece для отложенного колбэка — иначе таймер заблокирует экран,
  // даже если за время паузы включили громкую связь. Обновляем в эффекте
  // (обращаться к ref во время рендера нельзя).
  const earpieceRef = useRef(earpiece);
  useEffect(() => {
    earpieceRef.current = earpiece;
  }, [earpiece]);

  const scheduleLock = useCallback((delay: number) => {
    window.clearTimeout(lockTimer.current);
    lockTimer.current = window.setTimeout(() => {
      if (earpieceRef.current) setLocked(true);
    }, delay);
  }, []);

  // Ушли «к уху» — заблокировать после короткой паузы (даём увидеть, что
  // соединились). Не «к уху» (громкая связь, конец звонка) — снимаем таймер и
  // сбрасываем блок: overlay не размонтируется во время короткого окна 'ended',
  // и без сброса следующий звонок в том же mount открылся бы уже заблокированным
  // (без паузы-грации). Это осознанная синхронизация состояния с жизненным
  // циклом звонка, а не вычислимое во время рендера значение.
  useEffect(() => {
    if (!earpiece) {
      window.clearTimeout(lockTimer.current);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- сброс блокировки на завершение/смену маршрута звонка
      setLocked(false);
      return;
    }
    scheduleLock(LOCK_AFTER_CONNECT_MS);
    return () => window.clearTimeout(lockTimer.current);
  }, [earpiece, scheduleLock]);

  const unlock = () => {
    setLocked(false);
    scheduleLock(RELOCK_IDLE_MS); // снова к уху — заблокируем сами
  };
  const lockNow = () => {
    window.clearTimeout(lockTimer.current);
    setLocked(true);
  };
  // Обёртка нажатий: после осознанного действия отодвигаем авто-блокировку.
  const bump = (fn: () => void) => () => {
    fn();
    if (earpiece) scheduleLock(RELOCK_IDLE_MS);
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-bg/95 px-6 pb-[calc(env(safe-area-inset-bottom)+40px)] pt-[calc(env(safe-area-inset-top)+72px)] backdrop-blur-xl">
      {/* Кто и статус */}
      <div className="flex flex-1 flex-col items-center justify-center gap-6">
        <span
          className={`flex size-28 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-4xl font-semibold text-white shadow-2xl ${
            snap.status === 'outgoing' || incoming ? 'animate-pulse' : ''
          }`}
        >
          {initial}
        </span>
        <div className="text-center">
          <p className="text-2xl font-semibold">{snap.peerName || 'Участник'}</p>
          <p className="mt-1 text-base text-muted">
            {snap.status === 'active' && snap.startedAt
              ? fmtElapsed(now - snap.startedAt)
              : statusText(snap)}
          </p>
        </div>
      </div>

      {/* Управление */}
      {!ended && (
        <div className="flex w-full flex-wrap items-center justify-center gap-x-5 gap-y-4">
          {incoming ? (
            <>
              <CallButton color="danger" label="Отклонить" onClick={() => callManager.decline()}>
                <PhoneOff size={28} />
              </CallButton>
              <CallButton color="success" label="Ответить" onClick={() => void callManager.accept()}>
                <Phone size={28} />
              </CallButton>
            </>
          ) : (
            <>
              <CallButton
                color={snap.muted ? 'active' : 'surface'}
                label={snap.muted ? 'Включить' : 'Микрофон'}
                onClick={bump(() => callManager.toggleMute())}
              >
                {snap.muted ? <MicOff size={26} /> : <Mic size={26} />}
              </CallButton>
              {snap.speakerAvailable && (
                <CallButton
                  color={snap.speakerOn ? 'active' : 'surface'}
                  label={snap.speakerOn ? 'Динамик' : 'К уху'}
                  onClick={bump(() => void callManager.toggleSpeaker())}
                >
                  <Volume2 size={26} />
                </CallButton>
              )}
              {snap.outputPickerAvailable && (
                <CallButton
                  color="surface"
                  label="Наушники"
                  onClick={bump(() => callManager.showOutputPicker())}
                >
                  <Headphones size={26} />
                </CallButton>
              )}
              {earpiece && (
                <CallButton color="surface" label="Блокировка" onClick={lockNow}>
                  <Lock size={24} />
                </CallButton>
              )}
              <CallButton color="danger" label="Завершить" onClick={bump(() => callManager.hangup())}>
                <PhoneOff size={28} />
              </CallButton>
            </>
          )}
        </div>
      )}
    </div>
    {locked && earpiece && (
      <CallGuard
        peerName={snap.peerName || 'Участник'}
        elapsed={snap.startedAt ? fmtElapsed(now - snap.startedAt) : '0:00'}
        onUnlock={unlock}
      />
    )}
    </>
  );
}

function CallButton({
  children,
  label,
  color,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  color: 'danger' | 'success' | 'surface' | 'active';
  onClick: () => void;
}) {
  const cls =
    color === 'danger'
      ? 'bg-danger text-white'
      : color === 'success'
        ? 'bg-success text-white'
        : color === 'active'
          ? 'bg-accent text-white'
          : 'bg-surface-2 text-text';
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-2 active:scale-95" aria-label={label}>
      <span className={`flex size-16 items-center justify-center rounded-full shadow-lg ${cls}`}>{children}</span>
      <span className="text-xs text-muted">{label}</span>
    </button>
  );
}
