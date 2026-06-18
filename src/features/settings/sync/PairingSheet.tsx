import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { Copy, Check, Download, AlertTriangle } from 'lucide-react';
import { Sheet } from '../../../components/ui/Sheet';
import { Button } from '../../../components/ui/Button';
import { SegmentedControl } from '../../../components/ui/SegmentedControl';
import { getPairingCode, connectSync, runSync } from '../../../lib/sync';

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
  const [code, setCode] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [copied, setCopied] = useState(false);
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
          setError('Не удалось подключить. Проверьте код и попробуйте снова.');
          setBusy(false);
        });
    };
  });

  // show: получить код и нарисовать QR
  useEffect(() => {
    if (!(open && mode === 'show')) return;
    void getPairingCode().then(async (c) => {
      if (!c) return;
      setCode(c);
      setQrUrl(await QRCode.toDataURL(c, { margin: 1, width: 260 }));
    });
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
        setError('Нет доступа к камере. Вставьте код вручную.');
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
    const file = new File([code], 'life-hub-sync-key.txt', { type: 'text/plain' });
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
    <Sheet open={open} onClose={onClose} title={mode === 'show' ? 'Код для другого устройства' : 'Подключить устройство'}>
      {mode === 'show' ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Отсканируйте этот QR на втором устройстве (Настройки → Синхронизация → Подключить).
          </p>
          {qrUrl && (
            <div className="flex justify-center">
              <img src={qrUrl} alt="QR-код сопряжения" className="rounded-2xl bg-white p-3" width={260} height={260} />
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1 inline-flex items-center justify-center gap-2" onClick={copyCode}>
              {copied ? <Check size={18} /> : <Copy size={18} />}
              {copied ? 'Скопировано' : 'Скопировать код'}
            </Button>
            <Button variant="secondary" className="flex-1 inline-flex items-center justify-center gap-2" onClick={saveKeyFile}>
              <Download size={18} />
              Сохранить ключ
            </Button>
          </div>
          <div className="flex gap-2 rounded-xl bg-warning/10 p-3 text-sm text-warning">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <span>
              Любой, у кого есть этот код, получит доступ к данным и сможет их расшифровать. Не
              передавайте его и сохраните резервную копию — без ключа облачные данные не восстановить.
            </span>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <SegmentedControl options={SCAN_TABS} value={tab} onChange={setTab} />
          {tab === 'scan' ? (
            <div className="space-y-2">
              <div className="overflow-hidden rounded-2xl bg-black">
                <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
              </div>
              <p className="text-center text-sm text-muted">Наведите камеру на QR-код первого устройства</p>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={pasteVal}
                onChange={(e) => setPasteVal(e.target.value)}
                placeholder="Вставьте код сопряжения"
                rows={4}
                className="w-full rounded-xl border border-border bg-surface p-3 font-mono text-xs"
              />
              <Button
                className="w-full"
                disabled={!pasteVal.trim() || busy}
                onClick={() => connectRef.current(pasteVal)}
              >
                {busy ? 'Подключаю…' : 'Подключить'}
              </Button>
            </div>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}
