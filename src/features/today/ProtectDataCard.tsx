import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, ShieldCheck, X } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { pushEnabled } from '../../lib/push';

/**
 * Мягкое напоминание на «Сегодня»: защитить данные — включить синхронизацию,
 * облачную копию и уведомления. Показывается, пока и синхронизация, и
 * уведомления не включены; исчезает сама, когда оба включены. «Позже» скрывает
 * до следующего запуска (несознательно навсегда не прячем).
 *
 * Не включаем ничего по умолчанию намеренно: ключ шифрования нужно осознанно
 * сохранить, а разрешение на уведомления система запрашивает явным жестом —
 * поэтому карточка ведёт в Настройки, где каждый шаг делается сознательно.
 */
export function ProtectDataCard() {
  // Нормализуем к null: без этого «нет записи» (undefined) неотличимо от
  // «ещё грузится» (тоже undefined) — и карточка пряталась бы именно когда
  // синхронизации нет, то есть когда она нужнее всего.
  const syncCfg = useLiveQuery(() => db.sync.get('config').then((c) => c ?? null), []);
  const [dismissed, setDismissed] = useState(false);
  // pushEnabled() синхронный; для карточки достаточно значения на монтировании.
  const [pushOn] = useState(() => pushEnabled());
  const syncOn = Boolean(syncCfg?.enabled);

  if (dismissed) return null;
  if (syncCfg === undefined) return null; // ещё грузится — не мигаем
  if (syncOn && pushOn) return null; // всё под защитой — не мозолим глаз

  const text =
    !syncOn && !pushOn
      ? 'Синхронизация между устройствами, зашифрованная копия в облаке и напоминания даже при закрытом приложении.'
      : !syncOn
        ? 'Включите синхронизацию и облачную копию — данные переживут потерю или замену телефона.'
        : 'Включите уведомления — напоминания придут даже при закрытом приложении.';

  return (
    <section className="mb-5">
      <div className="card relative p-4">
        <button
          type="button"
          aria-label="Позже"
          onClick={() => setDismissed(true)}
          className="absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-full text-muted active:opacity-60"
        >
          <X size={16} />
        </button>
        <div className="flex items-start gap-3 pr-6">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <ShieldCheck size={22} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold">Защитите свои данные</h3>
            <p className="mt-0.5 text-sm leading-relaxed text-muted">{text}</p>
            <Link
              to="/more/settings"
              className="mt-2.5 inline-flex items-center gap-1 text-sm font-semibold text-accent active:opacity-70"
            >
              Настроить
              <ChevronRight size={16} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
