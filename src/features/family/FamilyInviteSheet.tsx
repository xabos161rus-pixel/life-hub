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
          <span>
            Любой, у кого есть этот код, войдёт в группу и увидит общий чат и задачи. Делитесь только
            с близкими.
          </span>
        </div>
      </div>
    </Sheet>
  );
}
