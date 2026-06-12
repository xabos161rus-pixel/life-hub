import { useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '../../components/ui/Button';
import { Field, Input, Textarea } from '../../components/ui/Input';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { Sheet } from '../../components/ui/Sheet';
import { db } from '../../db/db';
import { alive, create, now, remove, update } from '../../db/repo';
import type { LearningItem, LearningKind } from '../../db/types';

type EditableStatus = 'planned' | 'inProgress' | 'done';
type ProgressUnit = LearningItem['progressUnit'];

const SELECT_CLASS =
  'w-full appearance-none rounded-xl bg-surface-2 border border-border px-3.5 py-3 text-text outline-none focus:border-accent';

interface Props {
  open: boolean;
  onClose: () => void;
  item?: LearningItem | null;
}

export function LearningItemSheet({ open, onClose, item }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title={item ? 'Материал' : 'Новый материал'}>
      {/* Sheet при !open возвращает null → форма размонтируется и при
          следующем открытии инициализируется заново из item. */}
      <ItemForm key={item?.id ?? 'new'} item={item ?? null} onClose={onClose} />
    </Sheet>
  );
}

function ItemForm({ item, onClose }: { item: LearningItem | null; onClose: () => void }) {
  const [title, setTitle] = useState(item?.title ?? '');
  const [author, setAuthor] = useState(item?.author ?? '');
  const [kind, setKind] = useState<LearningKind>(item?.kind ?? 'book');
  const [status, setStatus] = useState<EditableStatus>(
    item ? (item.status === 'dropped' ? 'done' : item.status) : 'planned',
  );
  const [unit, setUnit] = useState<ProgressUnit>(item?.progressUnit ?? 'percent');
  const [targetStr, setTargetStr] = useState(
    item && item.progressUnit !== 'percent' ? String(item.progressTarget) : '',
  );
  const [goalId, setGoalId] = useState(item?.goalId ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');

  const goalRows = useLiveQuery(
    () => db.goals.where('status').equals('active').toArray(),
    [],
  );
  const goals = alive(goalRows ?? []);

  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const progressTarget = unit === 'percent' ? 100 : Math.max(1, Number(targetStr) || 1);
    const base = {
      title: trimmed,
      author: author.trim(),
      kind,
      status,
      goalId: goalId || null,
      progressUnit: unit,
      progressTarget,
      notes: notes.trim(),
    };
    if (item) {
      const changes: Partial<Omit<LearningItem, 'id' | 'createdAt'>> = {
        ...base,
        progressCurrent: Math.min(item.progressCurrent, progressTarget),
      };
      if (status === 'inProgress' && !item.startedAt) changes.startedAt = now();
      if (status === 'done' && !item.finishedAt) changes.finishedAt = now();
      await update(db.learningItems, item.id, changes);
    } else {
      await create(db.learningItems, {
        ...base,
        progressCurrent: 0,
        startedAt: status !== 'planned' ? now() : null,
        finishedAt: status === 'done' ? now() : null,
      });
    }
    onClose();
  };

  const handleDelete = async () => {
    if (!item) return;
    if (!window.confirm('Удалить материал?')) return;
    await remove(db.learningItems, item.id);
    onClose();
  };

  return (
    <div className="space-y-4 pb-2">
        <Field label="Название">
          <Input
            value={title}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
            placeholder="Например, «Атомные привычки»"
          />
        </Field>
        <Field label="Автор">
          <Input
            value={author}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAuthor(e.target.value)}
            placeholder="Автор или источник"
          />
        </Field>
        <Field label="Тип">
          <SegmentedControl<LearningKind>
            options={[
              { value: 'book', label: 'Книга' },
              { value: 'course', label: 'Курс' },
              { value: 'article', label: 'Статья' },
              { value: 'video', label: 'Видео' },
            ]}
            value={kind}
            onChange={setKind}
          />
        </Field>
        <Field label="Статус">
          <SegmentedControl<EditableStatus>
            options={[
              { value: 'planned', label: 'В планах' },
              { value: 'inProgress', label: 'В процессе' },
              { value: 'done', label: 'Завершено' },
            ]}
            value={status}
            onChange={setStatus}
          />
        </Field>
        <Field label="Единица прогресса">
          <SegmentedControl<ProgressUnit>
            options={[
              { value: 'percent', label: '%' },
              { value: 'pages', label: 'Страницы' },
              { value: 'lessons', label: 'Уроки' },
            ]}
            value={unit}
            onChange={setUnit}
          />
        </Field>
        {unit !== 'percent' && (
          <Field label={unit === 'pages' ? 'Всего страниц' : 'Всего уроков'}>
            <Input
              type="number"
              inputMode="numeric"
              min={1}
              value={targetStr}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTargetStr(e.target.value)}
              placeholder={unit === 'pages' ? 'Например, 340' : 'Например, 20'}
            />
          </Field>
        )}
        <Field label="Цель">
          <select
            value={goalId}
            onChange={(e: ChangeEvent<HTMLSelectElement>) => setGoalId(e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">Без цели</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Заметки">
          <Textarea
            value={notes}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
            placeholder="Мысли, цитаты, выводы…"
            rows={3}
          />
        </Field>
        <div className="flex gap-2 pt-1">
          {item && (
            <Button variant="danger" onClick={() => void handleDelete()}>
              Удалить
            </Button>
          )}
          <Button
            className="flex-1"
            disabled={!title.trim()}
            onClick={() => void handleSave()}
          >
            Сохранить
          </Button>
      </div>
    </div>
  );
}
