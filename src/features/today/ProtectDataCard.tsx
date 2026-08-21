import { useState } from 'react';
import { Link } from 'react-router';
import { ShieldCheck } from 'lucide-react';
import {
  GChevronRight as ChevronRight,
  GClose as X,
} from '../../components/ui/glyphs';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { pushEnabled } from '../../lib/push';
import { HIT_SLOP_44_POSITIONED } from '../../components/ui/hitSlop';
import { t } from '../../lib/i18n';
import { ICON } from '../../components/ui/icons';

/**
 * Мягкое напоминание на «Сегодня»: защитить данные — включить синхронизацию,
 * облачную копию и уведомления. Показывается, пока и синхронизация, и
 * уведомления не включены; исчезает сама, когда оба включены. «Скрыть» скрывает
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
      ? t('Синхронизация между устройствами, зашифрованная копия в облаке и напоминания даже при закрытом приложении.')
      : !syncOn
        ? t('Включите синхронизацию и облачную копию — данные переживут потерю или замену телефона.')
        : t('Включите уведомления — напоминания придут даже при закрытом приложении.');
  // Заголовок следует за содержимым: когда осталось включить только
  // уведомления, «Защитите свои данные» над текстом про напоминания читался
  // рассинхроном — карточка будто про одно, а просит другое.
  const title = syncOn && !pushOn ? t('Не пропускайте напоминания') : t('Защитите свои данные');

  return (
    <section className="mb-5">
      <div className="card relative p-4">
        <button
          type="button"
          aria-label={t('Скрыть')}
          onClick={() => setDismissed(true)}
          className={`absolute top-2.5 right-2.5 flex size-7 items-center justify-center rounded-full text-muted active:opacity-60 ${HIT_SLOP_44_POSITIONED}`}
        >
          <X size={ICON.action} />
        </button>
        <div className="flex items-start gap-3 pr-6">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl tile-accent text-accent">
            <ShieldCheck size={ICON.header} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold">{title}</h3>
            <p className="mt-0.5 text-sm leading-relaxed text-muted">{text}</p>
            <Link
              to="/more/settings"
              className="mt-2.5 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-accent active:opacity-70"
            >
              {t('Настроить')}
              <ChevronRight size={ICON.action} />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
