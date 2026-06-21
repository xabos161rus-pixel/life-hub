import { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Plus, ScanLine } from 'lucide-react';
import { Sheet } from '../../components/ui/Sheet';
import { Field, Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { createFamily, joinFamily } from '../../lib/family/familyLifecycle';

const JOIN_TABS = [
  { value: 'scan' as const, label: 'Сканировать' },
  { value: 'paste' as const, label: 'Вставить код' },
];

/** Первый экран семьи (групп ещё нет): крупная иконка «＋» с подсказкой.
 *  По нажатию — выбор «Создать группу / Войти по приглашению».
 *  onReady получает familyId созданной/выбранной группы — чтобы её сразу открыть. */
export function FamilyOnboarding({ onReady }: { onReady?: (familyId: string) => void }) {
  const [mode, setMode] = useState<null | 'choose' | 'create' | 'join'>(null);

  return (
    <div className="flex flex-col items-center justify-center gap-5 py-20 text-center">
      <button
        onClick={() => setMode('choose')}
        aria-label="Создать группу или войти по приглашению"
        className="flex size-20 items-center justify-center rounded-[1.6rem] bg-gradient-to-br from-accent to-accent-2 text-white shadow-accent active:scale-95"
      >
        <Plus size={40} strokeWidth={2.4} />
      </button>
      <div className="space-y-1.5">
        <p className="text-lg font-semibold">Создать или войти по приглашению</p>
        <p className="px-6 text-sm text-muted">Общий чат и задачи с близкими. Содержимое шифруется на устройстве.</p>
      </div>

      <Sheet open={mode === 'choose'} onClose={() => setMode(null)} title="Семейная группа">
        <div className="space-y-3 pb-2">
          <Button className="w-full" onClick={() => setMode('create')}>
            Создать группу
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => setMode('join')}>
            Войти по приглашению
          </Button>
        </div>
      </Sheet>
      <CreateFamilySheet
        open={mode === 'create'}
        onClose={() => setMode(null)}
        onReady={(id) => {
          setMode(null);
          onReady?.(id);
        }}
      />
      <JoinFamilySheet
        open={mode === 'join'}
        onClose={() => setMode(null)}
        onReady={(id) => {
          setMode(null);
          onReady?.(id);
        }}
      />
    </div>
  );
}

export function CreateFamilySheet({ open, onClose, onReady }: { open: boolean; onClose: () => void; onReady?: (familyId: string) => void }) {
  const [familyName, setFamilyName] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!familyName.trim() || !name.trim() || busy) return;
    setBusy(true);
    try {
      const id = await createFamily(familyName, name);
      onClose();
      onReady?.(id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Создать группу">
      <div className="space-y-4">
        <Field label="Название группы">
          <Input value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="Например, «Наша семья»" />
        </Field>
        <Field label="Ваше имя">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Влад" />
        </Field>
        <Button className="w-full" disabled={!familyName.trim() || !name.trim() || busy} onClick={() => void create()}>
          {busy ? 'Создаю…' : 'Создать группу'}
        </Button>
      </div>
    </Sheet>
  );
}

export function JoinFamilySheet({ open, onClose, onReady }: { open: boolean; onClose: () => void; onReady?: (familyId: string) => void }) {
  const [name, setName] = useState('');
  const [tab, setTab] = useState<'scan' | 'paste'>('scan');
  const [pasteVal, setPasteVal] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef(0);

  // Подключение через ref (стабильная ссылка для камеры-эффекта).
  const joinRef = useRef<(code: string) => void>(() => {});
  useEffect(() => {
    joinRef.current = (code: string) => {
      if (busy) return;
      if (!name.trim()) {
        setError('Сначала введите своё имя');
        return;
      }
      setBusy(true);
      setError('');
      void joinFamily(code.trim(), name)
        .then((id) => {
          onClose();
          onReady?.(id);
        })
        .catch(() => {
          setError('Не удалось войти. Проверьте код.');
          setBusy(false);
        });
    };
  });

  useEffect(() => {
    if (!(open && tab === 'scan')) return;
    let cancelled = false;
    const stop = () => {
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
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
              stop();
              joinRef.current(found.data);
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
      stop();
    };
  }, [open, tab]);

  return (
    <Sheet open={open} onClose={onClose} title="Войти по приглашению">
      <div className="space-y-4">
        <Field label="Ваше имя">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Брат" />
        </Field>
        <SegmentedControl options={JOIN_TABS} value={tab} onChange={setTab} />
        {tab === 'scan' ? (
          <div className="space-y-2">
            <div className="relative overflow-hidden rounded-2xl bg-black">
              <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline />
              <ScanLine className="pointer-events-none absolute inset-0 m-auto text-white/40" size={120} />
            </div>
            <p className="text-center text-sm text-muted">Наведите камеру на QR приглашения</p>
          </div>
        ) : (
          <div className="space-y-2">
            <textarea
              value={pasteVal}
              onChange={(e) => setPasteVal(e.target.value)}
              placeholder="Вставьте код приглашения"
              rows={4}
              className="w-full rounded-xl border border-border bg-surface p-3 font-mono text-xs"
            />
            <Button className="w-full" disabled={!pasteVal.trim() || busy} onClick={() => joinRef.current(pasteVal)}>
              {busy ? 'Вхожу…' : 'Войти'}
            </Button>
          </div>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Sheet>
  );
}
