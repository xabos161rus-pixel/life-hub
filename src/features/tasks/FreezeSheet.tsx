import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Snowflake } from 'lucide-react';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { formatDueDate } from '../../lib/dates';
import { freezeTasks } from './taskActions';

/** Лист выбора задач для заморозки: мультивыбор активных (не выполненных, ещё не
 *  замороженных) задач → ставим на паузу разом. */
export function FreezeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const tasks = alive(useLiveQuery(() => db.tasks.toArray(), []) ?? []);
  const projects = alive(useLiveQuery(() => db.projects.toArray(), []) ?? []);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);

  const candidates = useMemo(
    () =>
      tasks
        .filter((t) => !t.completedAt && !t.frozenAt)
        .sort((a, b) => (a.dueDate ?? '￿').localeCompare(b.dueDate ?? '￿')),
    [tasks],
  );

  // Сброс выбора при открытии обеспечивает remount по key из родителя.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function confirm() {
    const toFreeze = candidates.filter((t) => selected.has(t.id));
    if (!toFreeze.length) return;
    await freezeTasks(toFreeze);
    toast(toFreeze.length === 1 ? 'Задача заморожена' : `Заморожено: ${toFreeze.length}`);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Заморозить задачи">
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Выберите задачи, чтобы поставить их на паузу. Они исчезнут из списка и статистики и
          перестанут напоминать — «как будто для них остановилось время». Разморозить можно в любой
          момент.
        </p>
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Нет активных задач для заморозки.</p>
        ) : (
          <div className="max-h-[50dvh] divide-y divide-hairline overflow-y-auto rounded-2xl border border-border bg-surface">
            {candidates.map((t) => {
              const project = t.projectId ? projectById.get(t.projectId) : null;
              const on = selected.has(t.id);
              return (
                <button
                  key={t.id}
                  onClick={() => toggle(t.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left active:opacity-70"
                >
                  <span
                    className={`flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                      on ? 'border-accent bg-accent text-white' : 'border-border'
                    }`}
                  >
                    {on && <Check size={13} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{t.title}</span>
                    <span className="block truncate text-xs text-muted">
                      {t.dueDate ? formatDueDate(t.dueDate) : 'без срока'}
                      {project ? ` · ${project.emoji} ${project.name}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        <Button
          className="inline-flex w-full items-center justify-center gap-2"
          disabled={selected.size === 0}
          onClick={() => void confirm()}
        >
          <Snowflake size={18} />
          Заморозить{selected.size > 0 ? ` (${selected.size})` : ''}
        </Button>
      </div>
    </Sheet>
  );
}
