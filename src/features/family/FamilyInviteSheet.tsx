import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, Download, AlertTriangle } from 'lucide-react';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { getFamilyInviteCode } from '../../lib/family/familyLifecycle';

interface Props {
  familyId: string;
  open: boolean;
  onClose: () => void;
}

/** Показ QR-кода приглашения в группу (для второго устройства/человека). */
export function FamilyInviteSheet({ familyId, open, onClose }: Props) {
  const [code, setCode] = useState('');
  const [qrUrl, setQrUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    void getFamilyInviteCode(familyId).then(async (c) => {
      if (!c) return;
      setCode(c);
      setQrUrl(await QRCode.toDataURL(c, { margin: 1, width: 260 }));
    });
  }, [open, familyId]);

  function copyCode() {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function saveFile() {
    const file = new File([code], 'life-hub-family-invite.txt', { type: 'text/plain' });
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
    <Sheet open={open} onClose={onClose} title="Пригласить в группу">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Покажите этот QR участнику: в его LifeHearth — «Ещё → Семья → ＋ → Войти по приглашению».
          Показать экран лично надёжнее, чем переслать код: пересланный код проходит через чужой
          мессенджер вместе с ключом от переписки.
        </p>
        {qrUrl && (
          <div className="flex justify-center">
            <img src={qrUrl} alt="QR-код приглашения" className="rounded-2xl bg-white p-3" width={260} height={260} />
          </div>
        )}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1 inline-flex items-center justify-center gap-2" onClick={copyCode}>
            {copied ? <Check size={18} /> : <Copy size={18} />}
            {copied ? 'Скопировано' : 'Скопировать код'}
          </Button>
          <Button variant="secondary" className="flex-1 inline-flex items-center justify-center gap-2" onClick={saveFile}>
            <Download size={18} />
            Сохранить
          </Button>
        </div>
        <div className="flex gap-2 rounded-xl bg-warning/10 p-3 text-sm text-warning">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          {/* Прямо о том, что отдаётся. Прежняя формулировка говорила «войдёт в
              группу», но умалчивала три вещи, каждая из которых меняет решение:
              в коде лежит ключ шифрования, он открывает и прошлую переписку, и
              отобрать доступ обратно нечем. */}
          <span>
            В этом коде — ключ от переписки. Кто его получит, прочитает и прошлые сообщения тоже, а
            отозвать доступ обратно пока нельзя. Передавайте лично или в защищённом мессенджере и
            только тем, кому доверяете.
          </span>
        </div>
      </div>
    </Sheet>
  );
}
