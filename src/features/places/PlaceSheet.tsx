import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Field, Input, Textarea } from '../../components/ui/Input';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Sheet } from '../../components/ui/Sheet';
import { db } from '../../db/db';
import { create, remove, update } from '../../db/repo';
import type { PlaceItem, PlaceKind, PlaceStatus } from '../../db/types';

interface Props {
  open: boolean;
  onClose: () => void;
  item: PlaceItem | null;
}

export function PlaceSheet({ open, onClose, item }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title={item ? 'Запись' : 'Новая запись'}>
      {/* Sheet при !open возвращает null → форма размонтируется и при
          следующем открытии инициализируется заново из item. */}
      <PlaceForm key={item?.id ?? 'new'} item={item} onClose={onClose} />
    </Sheet>
  );
}

function PlaceForm({ item, onClose }: { item: PlaceItem | null; onClose: () => void }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [kind, setKind] = useState<PlaceKind>(item?.kind ?? 'place');
  const [description, setDescription] = useState(item?.description ?? '');
  const [source, setSource] = useState(item?.source ?? '');
  const [location, setLocation] = useState(item?.location ?? '');
  const [link, setLink] = useState(item?.link ?? '');
  const [tagsStr, setTagsStr] = useState(item?.tags.join(', ') ?? '');
  const [status, setStatus] = useState<PlaceStatus>(item?.status ?? 'idea');

  const savingRef = useRef(false);
  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (savingRef.current) return; // защита от дабл-тапа
    savingRef.current = true;
    try {
      const tags = tagsStr
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
      const base = {
        title: trimmed,
        kind,
        description: description.trim(),
        source: source.trim(),
        location: location.trim(),
        link: link.trim(),
        tags,
        status,
      };
      if (item) {
        await update(db.placeItems, item.id, base);
      } else {
        await create(db.placeItems, { ...base, sortOrder: Date.now() });
      }
      onClose();
    } finally {
      savingRef.current = false;
    }
  };

  const handleDelete = async () => {
    if (!item) return;
    if (!window.confirm('Удалить запись?')) return;
    await remove(db.placeItems, item.id);
    onClose();
  };

  return (
    <div className="space-y-4 pb-2">
      <Field label="Название">
        <Input
          value={title}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
          placeholder="Например, «Кафе у моря»"
        />
      </Field>
      <Field label="Вид">
        <SegmentedControl<PlaceKind>
          options={[
            { value: 'place', label: 'Места' },
            { value: 'thing', label: 'Вещи' },
            { value: 'tip', label: 'Советы' },
            { value: 'food', label: 'Еда' },
            { value: 'travel', label: 'Путешествия' },
          ]}
          value={kind}
          onChange={setKind}
        />
      </Field>
      <Field label="Описание">
        <Textarea
          value={description}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
          placeholder="Совет, опыт, рекомендация…"
          rows={3}
        />
      </Field>
      <Field label="От кого">
        <Input
          value={source}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSource(e.target.value)}
          placeholder="Кто посоветовал"
        />
      </Field>
      <Field label="Где">
        <Input
          value={location}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setLocation(e.target.value)}
          placeholder="Город или адрес"
        />
      </Field>
      <Field label="Ссылка">
        <Input
          type="url"
          inputMode="url"
          value={link}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setLink(e.target.value)}
          placeholder="https://"
        />
      </Field>
      <Field label="Теги">
        <Input
          value={tagsStr}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTagsStr(e.target.value)}
          placeholder="Через запятую"
        />
      </Field>
      <Field label="Статус">
        <SegmentedControl<PlaceStatus>
          options={[
            { value: 'idea', label: 'Идея' },
            { value: 'want', label: 'Хочу' },
            { value: 'done', label: 'Был' },
          ]}
          value={status}
          onChange={setStatus}
        />
      </Field>
      <div className="flex gap-2 pt-1">
        {item && (
          <Button variant="danger" onClick={() => void handleDelete()}>
            Удалить
          </Button>
        )}
        <Button className="flex-1" disabled={!title.trim()} onClick={() => void handleSave()}>
          Сохранить
        </Button>
      </div>
    </div>
  );
}
