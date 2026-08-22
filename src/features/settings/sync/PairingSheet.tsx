import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  Download,
} from 'lucide-react';
import {
  GCheck as Check,
  GCopy as Copy,
  GAlert as TriangleAlert,
} from '../../../components/ui/glyphs';
import { Sheet } from '../../../components/ui/Sheet';
import { Button } from '../../../components/ui/Button';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { getBackupCode, startPairing, awaitPairing, connectSync, runSync } from '../../../lib/sync';
import { t } from '../../../lib/i18n';
import { ICON } from '../../../components/ui/icons';

interface Props {
  open: boolean;
  mode: 'show' | 'connect';
  onClose: () => void;
  onConnected?: () => void;
}

const SCAN_TABS = [
  { value: 'scan' as const, label: 'Сканировать' },
  { value: 'paste' as const, label: 'Вставить код' },
];

/** Диалог сопряжения устройств: показать свой QR/код (mode='show') либо
 *  подключиться к существующему аккаунту сканом/вводом (mode='connect'). */
export function PairingSheet({ open, mode, onClose, onConnected }: Props) {
  // --- show ---
  // code — код ВСТРЕЧИ для QR (секретов не содержит), backupCode — пакет
  // доступа целиком, он же резервная копия: уходит только в файл по кнопке.
  const [code, setCode] = useState('');
  const [backupCode, setBackupCode] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [paired, setPaired] = useState(false);
  // --- connect ---
  const [tab, setTab] = useState<'scan' | 'paste'>('scan');
  const [pasteVal, setPasteVal] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);

  // Подключение через ref, обновляемый в эффекте — стабильная ссылка для
  // камеры-эффекта (присваивать ref в теле рендера линтер запрещает).
  const connectRef = useRef<(raw: string) => void>(() => {});
  useEffect(() => {
    connectRef.current = (raw: string) => {
      if (busy) return;
      setBusy(true);
      setError('');
      void connectSync(raw.trim())
        .then(() => runSync())
        .then(() => {
          onConnected?.();
          onClose();
        })
        .catch(() => {
          setError(t('Не удалось подключить. Проверьте код и попробуйте снова.'));
          setBusy(false);
        });
    };
  });

  // show: открыть встречу, нарисовать QR и дождаться второго устройства.
  //
  // Ожидание идёт само, пока экран открыт: человек показывает QR, сканирует на
  // втором телефоне и видит здесь галочку. Нажимать ничего не нужно — порядок
  // действий ровно тот же, что был с прежним кодом.
  useEffect(() => {
    if (!(open && mode === 'show')) return;
    const signal = { aborted: false };
    // Сброс отметки — внутри цепочки, а не синхронно в теле эффекта: иначе
    // линтер справедливо ругается на каскад перерисовок.
    void getBackupCode().then((c) => {
      if (signal.aborted) return;
      setPaired(false);
      setBackupCode(c ?? '');
    });
    void startPairing().then(async (meet) => {
      if (!meet || signal.aborted) return;
      setCode(meet.code);
      setQrUrl(await QRCode.toDataURL(meet.code, { margin: 1, width: 260 }));
      const ok = await awaitPairing(meet.pairId, meet.priv, signal);
      if (!signal.aborted && ok) setPaired(true);
    });
    return () => {
      signal.aborted = true;
    };
  }, [open, mode]);

  // connect/scan: запустить камеру и искать QR в кадрах
  useEffect(() => {
    if (!(open && mode === 'connect' && tab === 'scan')) return;
    let cancelled = false;
    const stopCamera = () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const tick = () => {
          if (cancelled) return;
          if (v.readyState >= v.HAVE_ENOUGH_DATA && v.videoWidth) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const found = jsQR(img.data, img.width, img.height);
            if (found?.data) {
              cancelled = true;
              stopCamera();
              connectRef.current(found.data);
              return;
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        setError(t('Нет доступа к камере. Вставьте код вручную.'));
        setTab('paste');
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [open, mode, tab]);

  function copyCode() {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function saveKeyFile() {
    // В файл уходит именно пакет доступа, а не код встречи: файл сохраняют на
    // случай потери телефона, и по коду встречи, который гаснет через четверть
    // часа, потом ничего не восстановить.
    const file = new File([backupCode], 'life-hub-sync-key.txt', { type: 'text/plain' });
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <Sheet open={open} onClose={onClose} title={mode === 'show' ? t('Код для другого устройства') : t('Подключить устройство')}>
      {mode === 'show' ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {t('Отсканируйте этот QR на втором устройстве (Настройки → Синхронизация → Подключить).')}
          </p>
          {paired ? (
            <p className="flex items-center justify-center gap-2 text-sm font-semibold text-success">
              <Check size={ICON.base} />
              {t('Устройство подключено')}
            </p>
          ) : (
            <p className="text-center text-xs text-muted">{t('Код действует 15 минут и только один раз')}</p>
          )}
          {qrUrl && (
            <div className="flex justify-center">
              <img src={qrUrl} alt={t('QR-код сопряжения')} className="rounded-2xl bg-white p-3" width={260} height={260} />
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1 inline-flex items-center justify-center gap-2" onClick={copyCode}>
              {copied ? <Check size={ICON.base} /> : <Copy size={ICON.base} />}
              {copied ? t('Скопировано') : t('Скопировать код')}
            </Button>
            <Button variant="secondary" className="flex-1 inline-flex items-center justify-center gap-2" onClick={saveKeyFile}>
              <Download size={ICON.base} />
              {t('Сохранить ключ')}
            </Button>
          </div>
          <div className="flex gap-2 rounded-xl bg-warning/10 p-3 text-sm text-warning">
            <TriangleAlert size={ICON.base} className="mt-0.5 shrink-0" />
            <span>
              {t('Файл с ключом открывает все ваши данные — храните его как ключ от квартиры. Но сохранить его нужно обязательно: без ключа облачные данные не восстановить.')}
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <SegmentedControl
            options={SCAN_TABS.map((o) => ({ ...o, label: t(o.label) }))}
            value={tab}
            onChange={setTab}
          />
          {tab === 'scan' ? (
            <div className="space-y-2">
              <div className="overflow-hidden rounded-2xl bg-black">
                <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
              </div>
              <p className="text-center text-sm text-muted">{t('Наведите камеру на QR-код первого устройства')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={pasteVal}
                onChange={(e) => setPasteVal(e.target.value)}
                placeholder={t('Вставьте код сопряжения')}
                rows={4}
                className="w-full rounded-xl border border-border bg-surface p-3 font-mono text-xs"
              />
              <Button
                className="w-full"
                disabled={!pasteVal.trim() || busy}
                onClick={() => connectRef.current(pasteVal)}
              >
                {busy ? t('Подключаю…') : t('Подключить')}
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}
