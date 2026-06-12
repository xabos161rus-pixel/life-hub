import { useEffect, useState } from 'react';
import { db } from '../../db/db';
import { alive, create, remove, update } from '../../db/repo';
import type { Project } from '../../db/types';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';
import { PRESET_COLORS } from '../../lib/colors';

/** Шит создания/редактирования проекта. project=null → создание. */
export function ProjectEditSheet({
  open,
  onClose,
  project,
}: {
  open: boolean;
  onClose: () => void;
  project?: Project | null;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('📁');
  const [color, setColor] = useState(PRESET_COLORS[0]);

  useEffect(() => {
    if (!open) return;
    setName(project?.name ?? '');
    setEmoji(project?.emoji ?? '📁');
    setColor(project?.color ?? PRESET_COLORS[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSave = async () => {
    const data = { name: name.trim(), emoji: emoji.trim() || '📁', color };
    if (project) {
      await update(db.projects, project.id, data);
    } else {
      await create(db.projects, { ...data, sortOrder: Date.now(), archivedAt: null });
    }
    onClose();
  };

  const handleDelete = async () => {
    if (!project) return;
    if (!window.confirm('Удалить проект? Его задачи останутся без проекта.')) return;
    // Задачи не удаляем — отвязываем от проекта.
    const tasks = alive(await db.tasks.where('projectId').equals(project.id).toArray());
    for (const t of tasks) {
      await update(db.tasks, t.id, { projectId: null });
    }
    await remove(db.projects, project.id);
    onClose();
  };

  return (
    <Sheet open={open} onClose={onClose} title={project ? 'Проект' : 'Новый проект'}>
      <div className="flex flex-col gap-4 pb-2">
        <Field label="Название">
          <Input
            value={name}
            autoFocus={!project}
            placeholder="Например, «Ремонт»"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field label="Эмодзи">
          <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} />
        </Field>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-muted">Цвет</span>
          <div className="flex flex-wrap gap-2.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Цвет ${c}`}
                onClick={() => setColor(c)}
                className={`size-9 rounded-full border-2 transition-colors ${
                  color === c ? 'border-text' : 'border-transparent'
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        <div className="mt-1 flex gap-2">
          {project && (
            <Button variant="danger" onClick={handleDelete}>
              Удалить
            </Button>
          )}
          <Button className="flex-1" disabled={!name.trim()} onClick={handleSave}>
            Сохранить
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
