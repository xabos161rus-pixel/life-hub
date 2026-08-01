import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Camera, User } from 'lucide-react';
import {
  GTrash as Trash2,
} from '../../components/ui/glyphs';
import { Screen } from '../../components/layout/Screen';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useToast } from '../../components/ui/toastContext';
import { db } from '../../db/db';
import { updateSettings } from '../../hooks/useSettings';
import {
  compressImage,
  ImageDecodeError,
  ImageTooLargeError,
  MAX_INPUT_BYTES,
} from '../../lib/image';

/** Числовое поле профиля: пустая строка означает «не указано», а не ноль.
 *  Ноль здесь — не значение: рост 0 см не бывает, а сохранённый ноль потом
 *  неотличим от «человек стёр». */
function parseNumber(raw: string): number | null {
  const t = raw.replace(',', '.').trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? v : null;
}

export function ProfilePage() {
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  // Форма редактируется локально и сохраняется по кнопке: посимвольная запись
  // в базу дёргала бы useLiveQuery на каждое нажатие и подменяла бы значение
  // под курсором.
  const [draft, setDraft] = useState<{
    name: string;
    birthDate: string;
    heightCm: string;
    weightKg: string;
  } | null>(null);

  const p = settings?.profile;
  const form = draft ?? {
    name: p?.name ?? '',
    birthDate: p?.birthDate ?? '',
    heightCm: p?.heightCm != null ? String(p.heightCm) : '',
    weightKg: p?.weightKg != null ? String(p.weightKg) : '',
  };
  const set = (patch: Partial<typeof form>) => setDraft({ ...form, ...patch });

  async function save() {
    if (busy) return;
    setBusy(true);
    try {
      await updateSettings({
        profile: {
          ...p,
          name: form.name.trim() || undefined,
          birthDate: form.birthDate || null,
          heightCm: parseNumber(form.heightCm),
          weightKg: parseNumber(form.weightKg),
        },
      });
      setDraft(null);
      toast('Сохранено');
    } finally {
      setBusy(false);
    }
  }

  async function pickAvatar(file: File) {
    setBusy(true);
    try {
      // Аватар мельче фото в чате: он рисуется кружком 56px, и хранить под
      // него мегабайт незачем. 256px хватает и для будущих крупных мест.
      const dataUrl = await compressImage(file, 256, 0.75);
      await updateSettings({ profile: { ...p, avatar: dataUrl } });
    } catch (err) {
      if (err instanceof ImageTooLargeError) {
        toast(`Файл больше ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} МБ`);
      } else if (err instanceof ImageDecodeError) {
        toast('Не удалось открыть фото. Попробуйте другой файл');
      } else {
        toast('Не удалось сохранить фото. Попробуйте ещё раз');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Профиль" backTo="/home">
      <div className="space-y-5">
        <div className="flex flex-col items-center gap-3">
          {p?.avatar ? (
            <img
              src={p.avatar}
              alt=""
              className="size-24 rounded-full object-cover"
              width={96}
              height={96}
            />
          ) : (
            <div className="flex size-24 items-center justify-center rounded-full bg-surface-2 text-muted">
              <User size={40} />
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void pickAvatar(f);
            }}
          />
          {/* Столбиком на узких экранах: две кнопки в ряд на 320px дают по
              118px, и «Удалить фото» переносится внутри кнопки. */}
          <div className="flex flex-col gap-2 min-[380px]:flex-row">
            <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
              <Camera size={16} className="-mt-0.5 mr-1.5 inline" />
              {p?.avatar ? 'Заменить фото' : 'Добавить фото'}
            </Button>
            {p?.avatar && (
              <Button
                variant="ghost"
                className="text-danger"
                disabled={busy}
                onClick={() => void updateSettings({ profile: { ...p, avatar: null } })}
              >
                <Trash2 size={16} className="-mt-0.5 mr-1.5 inline" />
                Удалить фото
              </Button>
            )}
          </div>
        </div>

        <div className="card space-y-4 p-4">
          <Field label="Имя">
            <Input
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Как вас зовут"
              autoComplete="name"
            />
          </Field>
          <Field label="Дата рождения">
            <Input
              type="date"
              value={form.birthDate}
              onChange={(e) => set({ birthDate: e.target.value })}
            />
          </Field>
          {/* Рост и вес рядом: числа короткие, а вместе они читаются как одна
              строка о себе. Ниже 380px переносим — два поля по 118px оставляют
              подписям меньше, чем нужно словам «Дата рождения». */}
          <div className="flex flex-col gap-4 min-[380px]:flex-row">
            <div className="min-w-0 flex-1">
              <Field label="Рост, см">
                <Input
                  inputMode="numeric"
                  value={form.heightCm}
                  onChange={(e) => set({ heightCm: e.target.value.replace(/[^\d]/g, '') })}
                  placeholder="—"
                />
              </Field>
            </div>
            <div className="min-w-0 flex-1">
              <Field label="Вес, кг">
                <Input
                  inputMode="decimal"
                  value={form.weightKg}
                  onChange={(e) => set({ weightKg: e.target.value.replace(/[^\d.,]/g, '') })}
                  placeholder="—"
                />
              </Field>
            </div>
          </div>
        </div>

        {/* Пол сохраняется сразу, мимо формы с кнопкой: от него зависит состав
            приложения (раздел «Женские дни» существует только в женском
            профиле), и отложенное «Сохранить» здесь только запутывало бы. */}
        <div className="card space-y-2 p-4">
          <Field label="Пол">
            <SegmentedControl<'female' | 'male'>
              options={[
                { value: 'female', label: 'Женский' },
                { value: 'male', label: 'Мужской' },
              ]}
              value={settings?.gender ?? 'female'}
              onChange={(v) => void updateSettings({ gender: v })}
            />
          </Field>
          <p className="text-xs leading-snug text-muted">
            Определяет набор разделов: «Женские дни» есть только в женском профиле. При смене
            пола записи раздела не удаляются — он просто скрывается.
          </p>
        </div>

        <Button className="w-full" disabled={busy || draft === null} onClick={() => void save()}>
          Сохранить
        </Button>

        {/* Профиль хранится там же, где остальные настройки приложения, — на
            устройстве. Человек, заполняющий рост и вес, вправе знать, куда они
            попадут, до того как их напишет. */}
        <p className="px-1 text-xs leading-snug text-muted">
          Эти данные остаются на устройстве и попадают только в вашу резервную копию. Никуда больше
          они не отправляются.
        </p>
      </div>
    </Screen>
  );
}
