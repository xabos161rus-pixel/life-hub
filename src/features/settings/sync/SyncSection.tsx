import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { RefreshCw, QrCode, Smartphone, ShieldCheck, Copy, RotateCcw } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/Toast';
import { getSyncConfig } from '../../../lib/syncState';
import { createSyncAccount, disableSync, runSync, resetAndResync } from '../../../lib/sync';
import { PairingSheet } from './PairingSheet';

/** Хвост тоста о пропущенных записях: молчаливый пропуск — скрытая потеря. */
function skippedTail(skipped: number): string {
  return skipped ? `, пропущено ${skipped}` : '';
}

function formatSyncedAt(iso: string): string {
  if (!iso) return 'ещё не синхронизировано';
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SyncSection() {
  const config = useLiveQuery(() => getSyncConfig(), []);
  const toast = useToast();
  const [sheet, setSheet] = useState<null | 'show' | 'connect'>(null);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (busy) return;
    setBusy(true);
    try {
      await createSyncAccount();
      await runSync().catch(() => {});
      toast('Синхронизация включена');
      setSheet('show'); // сразу показываем QR для второго устройства
    } finally {
      setBusy(false);
    }
  }

  async function handleSyncNow() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await runSync();
      if (r) toast(`Синхронизировано · получено ${r.pulled}, отправлено ${r.pushed}${skippedTail(r.skipped)}`);
    } catch {
      toast('Не удалось синхронизировать');
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyAccount() {
    if (!config) return;
    try {
      await navigator.clipboard.writeText(config.accountId);
      toast('ID аккаунта скопирован');
    } catch {
      // Клипборд недоступен (нет secure context / отказ WebKit) — показываем
      // значение в prompt, откуда его можно выделить и скопировать вручную.
      window.prompt('ID аккаунта — скопируйте вручную:', config.accountId);
    }
  }

  async function handleResetCursors() {
    if (busy) return;
    if (
      !window.confirm(
        'Пройти всю историю синхронизации заново?\n\nЭто выгрузит с сервера все записи аккаунта и переотправит локальные. Сопряжение устройств сохранится.\n\nВажно: записи, удалённые из корзины окончательно, могут вернуться — на сервере они ещё лежат.',
      )
    )
      return;
    setBusy(true);
    try {
      const r = await resetAndResync();
      // null = синк выключен или уже идёт. Рапортовать об успехе тут нельзя:
      // сброс в этом случае не состоялся.
      toast(
        r
          ? `Пересинхронизировано · получено ${r.pulled}, отправлено ${r.pushed}${skippedTail(r.skipped)}`
          : 'Синхронизация уже идёт — повторите через секунду',
      );
    } catch {
      toast('Не удалось пересинхронизировать');
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (!window.confirm('Отключить синхронизацию на этом устройстве? Локальные данные останутся на месте.')) return;
    await disableSync();
    toast('Синхронизация отключена');
  }

  return (
    <>
      <div className="space-y-3 rounded-2xl border border-border bg-surface p-4">
        {config ? (
          <>
            <p className="flex items-center gap-2 text-sm">
              <ShieldCheck size={18} className="shrink-0 text-success" />
              <span>
                <span className="font-medium text-success">Включена</span> · E2E-шифрование
                <br />
                <span className="text-muted">Последняя: {formatSyncedAt(config.lastSyncedAt)}</span>
              </span>
            </p>
            <Button className="w-full inline-flex items-center justify-center gap-2" disabled={busy} onClick={() => void handleSyncNow()}>
              <RefreshCw size={18} className={busy ? 'animate-spin' : ''} />
              Синхронизировать сейчас
            </Button>
            <Button
              variant="secondary"
              className="w-full inline-flex items-center justify-center gap-2"
              onClick={() => setSheet('show')}
            >
              <QrCode size={18} />
              Показать QR для другого устройства
            </Button>
            <button
              className="flex w-full items-center justify-between gap-3 rounded-xl bg-surface-2 px-3 py-2 text-left active:opacity-70"
              onClick={() => void handleCopyAccount()}
            >
              <span className="min-w-0">
                <span className="block text-xs text-muted">ID аккаунта</span>
                <span className="block font-mono text-xs break-all">{config.accountId}</span>
              </span>
              <Copy size={16} className="shrink-0 text-muted" />
            </button>
            <button
              className="inline-flex w-full items-center justify-center gap-2 pt-1 text-sm text-muted active:opacity-60 disabled:opacity-40"
              disabled={busy}
              onClick={() => void handleResetCursors()}
            >
              <RotateCcw size={16} className={busy ? 'animate-spin' : ''} />
              Пройти историю синхронизации заново
            </button>
            <button
              className="w-full pt-1 text-sm text-danger active:opacity-60"
              onClick={() => void handleDisable()}
            >
              Отключить синхронизацию
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              Синхронизируйте задачи, заметки, цели и финансы между устройствами. Содержимое
              шифруется на устройстве (E2E) — на сервере только шифротекст.
            </p>
            <Button className="w-full" disabled={busy} onClick={() => void handleCreate()}>
              Включить на этом устройстве
            </Button>
            <Button
              variant="secondary"
              className="w-full inline-flex items-center justify-center gap-2"
              onClick={() => setSheet('connect')}
            >
              <Smartphone size={18} />
              Подключить к другому устройству
            </Button>
          </>
        )}
      </div>

      <PairingSheet
        open={sheet !== null}
        mode={sheet === 'connect' ? 'connect' : 'show'}
        onClose={() => setSheet(null)}
        onConnected={() => toast('Устройство подключено')}
      />
    </>
  );
}
