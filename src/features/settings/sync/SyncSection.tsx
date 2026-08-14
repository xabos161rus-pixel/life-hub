import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { RefreshCw, QrCode, Smartphone, ShieldCheck } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/toastContext';
import { getSyncConfig } from '../../../lib/syncState';
import { createSyncAccount, disableSync, runSync } from '../../../lib/sync';
import { PairingSheet } from './PairingSheet';
import { t } from '../../../lib/i18n';

function formatSyncedAt(iso: string): string {
  if (!iso) return t('ещё не синхронизировано');
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
      toast(t('Синхронизация включена'));
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
      if (r) toast(t('Синхронизировано · получено {pulled}, отправлено {pushed}', { pulled: r.pulled, pushed: r.pushed }));
    } catch {
      toast(t('Не удалось синхронизировать. Проверьте связь и попробуйте ещё раз'));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisable() {
    if (!window.confirm(t('Отключить синхронизацию на этом устройстве? Локальные данные останутся на месте.'))) return;
    await disableSync();
    toast(t('Синхронизация отключена'));
  }

  return (
    <>
      <div className="space-y-3 card p-4">
        {config ? (
          <>
            <p className="flex items-center gap-2 text-sm">
              <ShieldCheck size={18} className="shrink-0 text-success" />
              <span>
                <span className="font-medium text-success">{t('Включена')}</span> · {t('E2E-шифрование')}
                <br />
                <span className="text-muted">{t('Последняя: {when}', { when: formatSyncedAt(config.lastSyncedAt) })}</span>
              </span>
            </p>
            <Button className="w-full inline-flex items-center justify-center gap-2" disabled={busy} onClick={() => void handleSyncNow()}>
              <RefreshCw size={18} className={busy ? 'animate-spin' : ''} />
              {t('Синхронизировать сейчас')}
            </Button>
            <Button
              variant="secondary"
              className="w-full inline-flex items-center justify-center gap-2"
              onClick={() => setSheet('show')}
            >
              <QrCode size={18} />
              {t('Показать QR для другого устройства')}
            </Button>
            <button
              className="w-full pt-1 text-sm text-danger active:opacity-60"
              onClick={() => void handleDisable()}
            >
              {t('Отключить синхронизацию')}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              {t('Синхронизируйте задачи, заметки, цели и финансы между устройствами. Содержимое шифруется на устройстве (E2E) — на сервере только шифротекст.')}
            </p>
            <Button className="w-full" disabled={busy} onClick={() => void handleCreate()}>
              {t('Включить на этом устройстве')}
            </Button>
            <Button
              variant="secondary"
              className="w-full inline-flex items-center justify-center gap-2"
              onClick={() => setSheet('connect')}
            >
              <Smartphone size={18} className="shrink-0" />
              {t('Подключить к другому устройству')}
            </Button>
          </>
        )}
      </div>

      <PairingSheet
        open={sheet !== null}
        mode={sheet === 'connect' ? 'connect' : 'show'}
        onClose={() => setSheet(null)}
        onConnected={() => toast(t('Устройство подключено'))}
      />
    </>
  );
}
