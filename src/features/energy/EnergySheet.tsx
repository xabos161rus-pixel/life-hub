import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Chip, ChipRow } from '../../components/ui/Chip';
import { AutoGrowTextarea, Field, Input } from '../../components/ui/Input';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Sheet } from '../../components/ui/Sheet';
import { db } from '../../db/db';
import { create, remove, update } from '../../db/repo';
import type { EnergyEffort, EnergyItem } from '../../db/types';

const CATEGORY_SUGGESTIONS = [
  'Тело',
  'Отдых',
  'Сон',
  'Общение',
  'Природа',
  'Творчество',
  'Музыка',
  'Еда',
];

interface Props {
  open: boolean;
  onClose: () => void;
  item?: EnergyItem | null;
}

export function EnergySheet({ open, onClose, item }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title={item ? 'Способ' : 'Новый способ'}>
      {/* Sheet при !open возвращает null → форма размонтируется и при
          следующем открытии инициализируется заново из item. */}
      <ItemForm key={item?.id ?? 'new'} item={item ?? null} onClose={onClose} />
    </Sheet>
  );
}

function EffectivenessPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-label={`${n} из 5`}
          className={`size-6 rounded-full transition-colors ${
            n <= value ? 'bg-accent' : 'bg-surface-2 border border-hairline'
          }`}
        />
      ))}
    </div>
  );
}

function ItemForm({ item, onClose }: { item: EnergyItem | null; onClose: () => void }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [description, setDescription] = useState(item?.description ?? '');
  const [category, setCategory] = useState(item?.category ?? '');
  const [effectiveness, setEffectiveness] = useState(item?.effectiveness ?? 3);
  const [effort, setEffort] = useState<EnergyEffort>(item?.effort ?? 'low');

  const savingRef = useRef(false);
  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (savingRef.current) return; // защита от дабл-тапа
    savingRef.current = true;
    try {
      const base = {
        title: trimmed,
        description: description.trim(),
        category: category.trim(),
        effectiveness,
        effort,
      };
      if (item) {
        await update(db.energyItems, item.id, base);
      } else {
        await create(db.energyItems, {
          ...base,
          sortOrder: Date.now(),
        });
      }
      onClose();
    } finally {
      savingRef.current = false;
    }
  };

  const handleDelete = async () => {
    if (!item) return;
    if (!window.confirm('Удалить способ?')) return;
    await remove(db.energyItems, item.id);
    onClose();
  };

  return (
    <div className="space-y-4 pb-2">
      <Field label="Название">
        <AutoGrowTextarea
          value={title}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setTitle(e.target.value)}
          onClear={() => setTitle('')}
          placeholder="Например, «Прогулка без телефона»"
        />
      </Field>
      <Field label="Что именно делать">
        <AutoGrowTextarea
          value={description}
          onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setDescription(e.target.value)}
          placeholder="Опишите способ так, чтобы потом не пришлось думать"
          className="min-h-[4.5rem]"
        />
      </Field>
      <Field label="Категория">
        <Input
          value={category}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setCategory(e.target.value)}
          placeholder="Тело, Отдых, Природа…"
        />
      </Field>
      <ChipRow>
        {CATEGORY_SUGGESTIONS.map((c) => (
          <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
            {c}
          </Chip>
        ))}
      </ChipRow>
      <Field label="Насколько помогает">
        <EffectivenessPicker value={effectiveness} onChange={setEffectiveness} />
      </Field>
      <Field label="Сколько сил требует">
        <SegmentedControl<EnergyEffort>
          options={[
            { value: 'low', label: 'Мало' },
            { value: 'medium', label: 'Средне' },
            { value: 'high', label: 'Много' },
          ]}
          value={effort}
          onChange={setEffort}
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
