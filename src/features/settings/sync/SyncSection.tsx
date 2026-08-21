import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  RefreshCw,
  QrCode,
  Smartphone,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useToast } from '../../../components/ui/toastContext';
import { getSyncConfig } from '../../../lib/syncState';
import { createSyncAccount, disableSync, runSync } from '../../../lib/sync';
import { PairingSheet } from './PairingSheet';
import { t } from '../../../lib/i18n';
import { ICON } from '../../../components/ui/icons';
import {
  GCopy as Copy,
} from '../../../components/ui/glyphs';

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
      // Пропущенные — «ядовитые» записи (битый шифротекст): цикл жив, но о
      // проблеме надо сказать, иначе потерю данных не заметить.
      if (r && r.skipped > 0) toast(t('Синхронизировано · получено {pulled}, отправлено {pushed}, пропущено {skipped}', { pulled: r.pulled, pushed: r.pushed, skipped: r.skipped }));
      else if (r) toast(t('Синхронизировано · получено {pulled}, отправлено {pushed}', { pulled: r.pulled, pushed: r.pushed }));
    } catch {
      toast(t('Не удалось синхронизировать. Проверьте связь и попробуйте ещё раз'));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopyAccount() {
    if (!config) return;
    try {
      await navigator.clipboard.writeText(config.accountId);
      toast(t('ID аккаунта скопирован'));
    } catch {
      // Клипборд недоступен (нет secure context / отказ WebKit) — показываем
      // значение в prompt, откуда его можно выделить и скопировать вручную.
      window.prompt(t('ID аккаунта — скопируйте вручную:'), config.accountId);
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
              <ShieldCheck size={ICON.base} className="shrink-0 text-success" />
              <span>
                <span className="font-medium text-success">{t('Включена')}</span> · {t('E2E-шифрование')}
                <br />
                <span className="text-muted">{t('Последняя: {when}', { when: formatSyncedAt(config.lastSyncedAt) })}</span>
              </span>
            </p>
            <Button className="w-full inline-flex items-center justify-center gap-2" disabled={busy} onClick={() => void handleSyncNow()}>
              <RefreshCw size={ICON.base} className={busy ? 'animate-spin' : ''} />
              {t('Синхронизировать сейчас')}
            </Button>
            <Button
              variant="secondary"
              className="w-full inline-flex items-center justify-center gap-2"
              onClick={() => setSheet('show')}
            >
              <QrCode size={ICON.base} />
              {t('Показать QR для другого устройства')}
            </Button>
            {/* ID аккаунта нужен для allowlist AI-прокси в Worker (AI_ALLOWED_ACCOUNTS):
                значение вводится в дашборде Cloudflare руками, поэтому кнопка копирования. */}
            <button
              className="flex w-full items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-left active:opacity-60"
              onClick={() => void handleCopyAccount()}
            >
              <span className="min-w-0">
                <span className="block text-xs text-muted">{t('ID аккаунта')}</span>
                <span className="block font-mono text-xs break-all">{config.accountId}</span>
              </span>
              <Copy size={ICON.action} className="shrink-0 text-muted" />
            </button>
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
              <Smartphone size={ICON.base} className="shrink-0" />
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
