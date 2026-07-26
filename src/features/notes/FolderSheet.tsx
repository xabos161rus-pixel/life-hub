import { useState } from 'react';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { db } from '../../db/db';
import { create, update, remove } from '../../db/repo';
import { PRESET_COLORS } from '../../lib/colors';
import type { NoteFolder } from '../../db/types';

// Эмодзи, а не иконки: папку человек узнаёт с одного взгляда по картинке, а не
// прочитав название. Набор небольшой и по темам, которые реально заводят —
// длинный список превращает выбор в работу.
const EMOJIS = ['📁', '💼', '🏠', '💡', '📚', '✈️', '🍽', '💪', '❤️', '💰', '🎯', '🎬'];

/** Создание и правка папки. Одна и та же форма: разница только в том, есть ли
 *  кнопка удаления и что написано на главной кнопке. */
export function FolderSheet({
  open,
  folder,
  onClose,
}: {
  open: boolean;
  folder?: NoteFolder | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(folder?.name ?? '');
  const [emoji, setEmoji] = useState(folder?.emoji ?? EMOJIS[0]);
  const [color, setColor] = useState(folder?.color ?? PRESET_COLORS[0]);
  const [busy, setBusy] = useState(false);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      if (folder) {
        await update(db.noteFolders, folder.id, { name: trimmed, emoji, color });
      } else {
        await create(db.noteFolders, { name: trimmed, emoji, color, sortOrder: Date.now() });
      }
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (!folder) return;
    // Заметки НЕ удаляем вместе с папкой — это была бы потеря данных из-за
    // действия, которое человек считает организационным. Они возвращаются во
    // «Все заметки», и об этом сказано прямо в вопросе.
    if (!window.confirm(`Удалить папку «${folder.name}»? Заметки останутся — они вернутся в общий список.`)) return;
    const inside = await db.notes.where('folderId').equals(folder.id).toArray();
    for (const n of inside) await update(db.notes, n.id, { folderId: null });
    await remove(db.noteFolders, folder.id);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={folder ? 'Папка' : 'Новая папка'}>
      <div className="flex flex-col gap-4 pb-2">
        <Field label="Название">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например, «Работа»"
            autoFocus
          />
        </Field>

        <div>
          <p className="mb-2 px-1 text-sm font-semibold text-muted">Значок</p>
          <div className="grid grid-cols-6 gap-2">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                aria-label={`Значок ${e}`}
                aria-pressed={emoji === e}
                onClick={() => setEmoji(e)}
                className={`flex h-11 items-center justify-center rounded-xl text-lg transition-colors ${
                  emoji === e ? 'bg-accent-fill text-white' : 'bg-surface-2'
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 px-1 text-sm font-semibold text-muted">Цвет</p>
          <div className="flex flex-wrap gap-2">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Цвет ${c}`}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className={`size-11 rounded-full transition-transform ${
                  color === c ? 'scale-110 ring-2 ring-text ring-offset-2 ring-offset-surface' : ''
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        <Button className="w-full" disabled={!name.trim() || busy} onClick={() => void save()}>
          {folder ? 'Сохранить' : 'Создать папку'}
        </Button>
        {folder && (
          <button
            onClick={() => void del()}
            className="w-full py-2 text-sm text-danger active:opacity-60"
          >
            Удалить папку
          </button>
        )}
      </div>
    </Sheet>
  );
}
