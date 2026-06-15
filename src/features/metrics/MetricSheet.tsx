import { useRef, useState, type ChangeEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { Chip, ChipRow } from '../../components/ui/Chip';
import { Field, Input } from '../../components/ui/Input';
import { Sheet } from '../../components/ui/Sheet';
import { db } from '../../db/db';
import { create, remove, update } from '../../db/repo';
import { todayKey } from '../../lib/dates';
import { PRESET_COLORS } from '../../lib/colors';
import type { Metric } from '../../db/types';

const UNIT_SUGGESTIONS = ['%', 'кг', 'км', 'шт'];

interface Props {
  open: boolean;
  onClose: () => void;
  metric: Metric | null;
}

export function MetricSheet({ open, onClose, metric }: Props) {
  return (
    <Sheet open={open} onClose={onClose} title={metric ? 'Метрика' : 'Новая метрика'}>
      {/* Sheet при !open возвращает null → форма размонтируется и при
          следующем открытии инициализируется заново из metric. */}
      <MetricForm key={metric?.id ?? 'new'} metric={metric} onClose={onClose} />
    </Sheet>
  );
}

function MetricForm({ metric, onClose }: { metric: Metric | null; onClose: () => void }) {
  const [title, setTitle] = useState(metric?.title ?? '');
  const [unit, setUnit] = useState(metric?.unit ?? '');
  const [currentStr, setCurrentStr] = useState(metric ? String(metric.currentValue) : '');
  const [targetStr, setTargetStr] = useState(
    metric?.targetValue != null ? String(metric.targetValue) : '',
  );
  const [color, setColor] = useState(metric?.color ?? PRESET_COLORS[0]);

  const savingRef = useRef(false);
  const handleSave = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    if (savingRef.current) return; // защита от дабл-тапа
    savingRef.current = true;
    try {
      const currentValue = parseFloat(currentStr) || 0;
      const targetParsed = parseFloat(targetStr);
      const targetValue = targetStr.trim() && !Number.isNaN(targetParsed) ? targetParsed : null;
      const base = {
        title: trimmed,
        unit: unit.trim(),
        currentValue,
        targetValue,
        color,
      };
      if (metric) {
        await update(db.metrics, metric.id, base);
        // При заметном изменении текущего значения фиксируем точку истории.
        if (currentValue !== metric.currentValue) {
          await create(db.metricLogs, {
            metricId: metric.id,
            date: todayKey(),
            value: currentValue,
          });
        }
      } else {
        const created = await create(db.metrics, { ...base, sortOrder: Date.now() });
        await create(db.metricLogs, {
          metricId: created.id,
          date: todayKey(),
          value: currentValue,
        });
      }
      onClose();
    } finally {
      savingRef.current = false;
    }
  };

  const handleDelete = async () => {
    if (!metric) return;
    if (!window.confirm('Удалить метрику?')) return;
    await remove(db.metrics, metric.id);
    onClose();
  };

  return (
    <div className="space-y-4 pb-2">
      <Field label="Название">
        <Input
          value={title}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTitle(e.target.value)}
          placeholder="Например, «Вес» или «Английский»"
        />
      </Field>
      <Field label="Единица">
        <Input
          value={unit}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setUnit(e.target.value)}
          placeholder="%, кг, км…"
        />
      </Field>
      <ChipRow>
        {UNIT_SUGGESTIONS.map((u) => (
          <Chip key={u} active={unit === u} onClick={() => setUnit(u)}>
            {u}
          </Chip>
        ))}
      </ChipRow>
      <Field label="Текущее значение">
        <Input
          type="number"
          inputMode="decimal"
          value={currentStr}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentStr(e.target.value)}
          placeholder="0"
        />
      </Field>
      <Field label="Цель (необязательно)">
        <Input
          type="number"
          inputMode="decimal"
          value={targetStr}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTargetStr(e.target.value)}
          placeholder="Например, 100"
        />
      </Field>
      <Field label="Цвет">
        <div className="flex flex-wrap gap-2.5">
          {PRESET_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Цвет ${c}`}
              onClick={() => setColor(c)}
              className={`size-9 rounded-full transition-transform active:scale-90 ${
                color === c ? 'ring-2 ring-offset-2 ring-offset-elevated' : ''
              }`}
              style={{ backgroundColor: c, ['--tw-ring-color' as string]: c }}
            />
          ))}
        </div>
      </Field>
      <div className="flex gap-2 pt-1">
        {metric && (
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
