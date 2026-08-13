import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  GFolder as Folder,
} from '../../components/ui/glyphs';
import { db } from '../../db/db';
import { alive, create, remove, update } from '../../db/repo';
import type { Project } from '../../db/types';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { AutoGrowTextarea, Field, Input, Select } from '../../components/ui/Input';
import { PRESET_COLORS } from '../../lib/colors';
import { ICON, STROKE } from '../../components/ui/icons';
import { t } from '../../lib/i18n';

/** Шит создания/редактирования проекта. project=null → создание.
 *  defaults.parentId — предзаполненный родитель («+ Подпроект» из секции). */
export function ProjectEditSheet({
  open,
  onClose,
  project,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  project?: Project | null;
  defaults?: { parentId?: string | null };
}) {
  // Тело формы монтируется заново на каждое открытие: состояние
  // инициализируется из props, поэтому сброс через эффект не нужен.
  if (!open) return null;
  return <ProjectEditForm onClose={onClose} project={project} defaults={defaults} />;
}

function ProjectEditForm({
  onClose,
  project,
  defaults,
}: {
  onClose: () => void;
  project?: Project | null;
  defaults?: { parentId?: string | null };
}) {
  const allProjects =
    useLiveQuery(
      async () => alive(await db.projects.toArray()).filter((p) => !p.archivedAt),
      [],
    ) ?? [];

  const [name, setName] = useState(project?.name ?? '');
  const [emoji, setEmoji] = useState(project?.emoji ?? '📁');
  const [color, setColor] = useState(project?.color ?? PRESET_COLORS[0]);
  const [parentId, setParentId] = useState<string | null>(
    project ? (project.parentId ?? null) : (defaults?.parentId ?? null),
  );

  // У этого проекта уже есть подпроекты? Тогда его нельзя вложить в другой —
  // глубина ограничена двумя уровнями (проект → подпроекты).
  const hasChildren = Boolean(project) && allProjects.some((p) => p.parentId === project?.id);
  // Кандидаты в родители: только проекты верхнего уровня, кроме самого себя.
  const parentOptions = allProjects.filter((p) => !p.parentId && p.id !== project?.id);

  const savingRef = useRef(false);
  const handleSave = async () => {
    if (savingRef.current) return; // защита от дабл-тапа
    savingRef.current = true;
    try {
      const data = {
        name: name.trim(),
        emoji: emoji.trim() || '📁',
        color,
        parentId: hasChildren ? null : parentId,
      };
      if (project) {
        await update(db.projects, project.id, data);
      } else {
        await create(db.projects, { ...data, sortOrder: Date.now(), archivedAt: null });
      }
      onClose();
    } finally {
      savingRef.current = false;
    }
  };

  const handleDelete = async () => {
    if (!project) return;
    if (!window.confirm(t('Удалить проект? Его задачи останутся без проекта, а подпроекты поднимутся на верхний уровень.'))) return;
    // Задачи не удаляем — отвязываем от проекта.
    const tasks = alive(await db.tasks.where('projectId').equals(project.id).toArray());
    for (const task of tasks) {
      await update(db.tasks, task.id, { projectId: null });
    }
    // Подпроекты не удаляем — поднимаем на верхний уровень.
    const children = alive(await db.projects.toArray()).filter((p) => p.parentId === project.id);
    for (const c of children) {
      await update(db.projects, c.id, { parentId: null });
    }
    await remove(db.projects, project.id);
    onClose();
  };

  return (
    <Sheet open onClose={onClose} title={project ? t('Проект') : t('Новый проект')}>
      <div className="flex flex-col gap-4 pb-2">
        <Field label={t('Название')}>
          <AutoGrowTextarea
            value={name}
            placeholder={t('Например, «Ремонт»')}
            onChange={(e) => setName(e.target.value)}
            onClear={() => setName('')}
          />
        </Field>

        <Field label={t('Эмодзи')}>
          <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} />
        </Field>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-muted">{t('Внутри проекта')}</span>
          {hasChildren ? (
            <p className="rounded-xl bg-surface-2 px-3.5 py-3 text-sm text-muted">
              {t('У этого проекта есть подпроекты — его нельзя вложить в другой.')}
            </p>
          ) : (
            <Select value={parentId ?? ''} onChange={(e) => setParentId(e.target.value || null)}>
              <option value="">{t('Верхний уровень')}</option>
              {parentOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.emoji} {p.name}
                </option>
              ))}
            </Select>
          )}
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-muted">{t('Цвет')}</span>
          <div className="flex flex-wrap gap-2.5">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                aria-label={t('Цвет {c}', { c })}
                onClick={() => setColor(c)}
                className={`size-9 rounded-full border-2 transition-colors ${
                  color === c ? 'border-text' : 'border-transparent'
                }`}
                style={{ background: c }}
              />
            ))}
          </div>
          {/* Живой предпросмотр: так папка будет выглядеть в списке задач.
              Цветная папка показывается вместо стандартного 📁; своё эмодзи — как есть. */}
          <div className="mt-3 flex items-center gap-1.5 rounded-xl bg-surface-2 px-3 py-2.5">
            {emoji.trim() && emoji.trim() !== '📁' ? (
              <span className="text-base leading-none">{emoji.trim()}</span>
            ) : (
              <Folder size={ICON.base} aria-hidden strokeWidth={STROKE} style={{ color, fill: color }} />
            )}
            <span className="min-w-0 truncate text-sm font-bold tracking-tight">
              {name.trim() || t('Проект')}
            </span>
            <span className="ml-auto text-xs text-muted">{t('так будет в списке')}</span>
          </div>
        </div>

        <div className="mt-1 flex gap-2">
          {project && (
            <Button variant="danger" onClick={handleDelete}>
              {t('Удалить')}
            </Button>
          )}
          <Button className="flex-1" disabled={!name.trim()} onClick={handleSave}>
            {t('Сохранить')}
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
