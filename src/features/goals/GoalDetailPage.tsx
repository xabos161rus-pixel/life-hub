import { useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Book,
  FileText,
  GraduationCap,
  Minus,
  Pencil,
  Plus,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react';
import { db } from '../../db/db';
import { alive, update } from '../../db/repo';
import type { Habit, LearningItem, LearningKind, Task } from '../../db/types';
import { formatRu } from '../../lib/dates';
import { goalProgress, goalProgressLabel } from '../../lib/progress';
import { Screen } from '../../components/layout/Screen';
import { Input } from '../../components/ui/Input';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { ProgressRing } from '../../components/ui/ProgressRing';
import { Sheet } from '../../components/ui/Sheet';
import { TaskItem } from '../tasks/TaskItem';
import { TaskEditSheet } from '../tasks/TaskEditSheet';
import { GoalEditSheet } from './GoalEditSheet';

const KIND_ICONS: Record<LearningKind, LucideIcon> = {
  book: Book,
  course: GraduationCap,
  article: FileText,
  video: Video,
};

/** Заголовок секции с кнопкой действия справа. */
function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="font-bold">{title}</h2>
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="text-sm font-medium text-accent">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

/** Детальная страница цели: прогресс, связанные задачи, привычки, обучение. */
export function GoalDetailPage() {
  const { id } = useParams<{ id: string }>();

  // undefined — ещё грузится, null — записи нет.
  const goal = useLiveQuery(
    async () => (id ? ((await db.goals.get(id)) ?? null) : null),
    [id],
  );

  const goalTasks =
    useLiveQuery(
      () =>
        id ? db.tasks.where('goalId').equals(id).toArray().then(alive) : Promise.resolve<Task[]>([]),
      [id],
    ) ?? [];
  const allHabits = useLiveQuery(() => db.habits.toArray().then(alive), []) ?? [];
  const allLearning = useLiveQuery(() => db.learningItems.toArray().then(alive), []) ?? [];
  const projects = useLiveQuery(() => db.projects.toArray().then(alive), []) ?? [];

  const [editOpen, setEditOpen] = useState(false);
  const [taskSheetOpen, setTaskSheetOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [linkHabitOpen, setLinkHabitOpen] = useState(false);
  const [linkLearningOpen, setLinkLearningOpen] = useState(false);
  // Черновик ввода числового прогресса строкой (null = поле не редактируется).
  const [valueDraft, setValueDraft] = useState<string | null>(null);

  if (goal === undefined) {
    return <Screen title="Цель" backTo="/goals">{null}</Screen>;
  }

  if (goal === null || goal.deletedAt) {
    return (
      <Screen title="Цель" backTo="/goals">
        <div className="py-14 text-center">
          <p className="font-semibold text-muted">Цель не найдена</p>
          <Link to="/goals" className="mt-2 inline-block text-sm font-medium text-accent">
            К списку целей
          </Link>
        </div>
      </Screen>
    );
  }

  const progress = goalProgress(goal, goalTasks);
  const linkedHabits = allHabits.filter((h) => h.goalId === goal.id);
  const availableHabits = allHabits.filter((h) => h.goalId !== goal.id);
  const linkedLearning = allLearning.filter((li) => li.goalId === goal.id);
  const availableLearning = allLearning.filter((li) => li.goalId !== goal.id);
  const sortedTasks = [...goalTasks].sort(
    (a, b) => (a.completedAt ? 1 : 0) - (b.completedAt ? 1 : 0) || a.sortOrder - b.sortOrder,
  );
  const current = goal.currentValue ?? 0;

  async function setCurrentValue(value: number) {
    if (!goal || !Number.isFinite(value)) return;
    await update(db.goals, goal.id, { currentValue: Math.max(0, value) });
  }

  return (
    <Screen
      title={goal.title}
      backTo="/goals"
      right={
        <button
          type="button"
          aria-label="Редактировать"
          onClick={() => setEditOpen(true)}
          className="p-2 text-accent"
        >
          <Pencil size={20} />
        </button>
      }
    >
      {goal.description && (
        <p className="mb-4 whitespace-pre-wrap text-[15px] text-muted">{goal.description}</p>
      )}

      <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-4">
        <ProgressRing value={progress} size={96} strokeWidth={7} color={goal.color} />
        <div className="min-w-0">
          <p className="text-lg font-bold">{goalProgressLabel(goal, goalTasks)}</p>
          {goal.targetDate && (
            <p className="text-sm text-muted">Срок: {formatRu(goal.targetDate, 'd MMMM yyyy')}</p>
          )}
        </div>
      </div>

      {goal.status === 'active' && progress >= 100 && (
        <div className="mt-3 rounded-2xl border border-success/40 bg-success/10 p-4">
          <p className="font-semibold text-success">Цель достигнута?</p>
          <button
            type="button"
            onClick={() => update(db.goals, goal.id, { status: 'completed' })}
            className="mt-1 text-sm font-medium text-success underline"
          >
            Отметить завершённой
          </button>
        </div>
      )}

      <div className="mt-3">
        {goal.progressMode === 'manual' && (
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="mb-2 text-sm font-medium text-muted">Прогресс вручную</p>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={goal.progressManual}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                update(db.goals, goal.id, { progressManual: Number(e.target.value) })
              }
              className="w-full"
              style={{ accentColor: goal.color }}
            />
          </div>
        )}
        {goal.progressMode === 'numeric' && (
          <div className="rounded-2xl border border-border bg-surface p-4">
            <p className="mb-2 text-sm font-medium text-muted">
              {current} из {goal.targetValue ?? 0}
              {goal.unitLabel ? ` ${goal.unitLabel}` : ''}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Уменьшить"
                onClick={() => {
                  setValueDraft(null);
                  void setCurrentValue(current - 1);
                }}
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 active:opacity-70"
              >
                <Minus size={18} />
              </button>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                value={valueDraft ?? String(current)}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setValueDraft(e.target.value)}
                onBlur={() => {
                  if (valueDraft === null) return;
                  const n = Number(valueDraft);
                  if (valueDraft.trim() !== '' && Number.isFinite(n)) void setCurrentValue(n);
                  setValueDraft(null);
                }}
                className="text-center"
              />
              <button
                type="button"
                aria-label="Увеличить"
                onClick={() => {
                  setValueDraft(null);
                  void setCurrentValue(current + 1);
                }}
                className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 active:opacity-70"
              >
                <Plus size={18} />
              </button>
            </div>
          </div>
        )}
        {goal.progressMode === 'tasks' && (
          <p className="px-1 text-sm text-muted">Прогресс считается по задачам ниже.</p>
        )}
      </div>

      <section className="mt-6">
        <SectionHeader title="Задачи" />
        {sortedTasks.length === 0 && (
          <p className="px-1 text-sm text-muted">Нет привязанных задач.</p>
        )}
        <div className="flex flex-col gap-2">
          {sortedTasks.map((t) => (
            <TaskItem
              key={t.id}
              task={t}
              project={projects.find((p) => p.id === t.projectId) ?? null}
              onEdit={(task) => {
                setEditingTask(task);
                setTaskSheetOpen(true);
              }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setEditingTask(null);
            setTaskSheetOpen(true);
          }}
          className="mt-2 flex items-center gap-1.5 px-1 py-2 text-sm font-medium text-accent"
        >
          <Plus size={16} /> Задача
        </button>
      </section>

      <section className="mt-6">
        <SectionHeader
          title="Привычки"
          actionLabel="Привязать"
          onAction={() => setLinkHabitOpen(true)}
        />
        {linkedHabits.length === 0 && (
          <p className="px-1 text-sm text-muted">Нет привязанных привычек.</p>
        )}
        <div className="flex flex-col gap-2">
          {linkedHabits.map((h: Habit) => (
            <div
              key={h.id}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3.5"
            >
              <span className="text-xl">{h.emoji}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{h.name}</span>
              <button
                type="button"
                aria-label="Отвязать"
                onClick={() => update(db.habits, h.id, { goalId: null })}
                className="p-1.5 text-muted"
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-6">
        <SectionHeader
          title="Обучение"
          actionLabel="Привязать"
          onAction={() => setLinkLearningOpen(true)}
        />
        {linkedLearning.length === 0 && (
          <p className="px-1 text-sm text-muted">Нет привязанных материалов.</p>
        )}
        <div className="flex flex-col gap-2">
          {linkedLearning.map((li: LearningItem) => {
            const Icon = KIND_ICONS[li.kind];
            return (
              <div
                key={li.id}
                className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3.5"
              >
                <Icon size={18} className="shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{li.title}</p>
                  <div className="mt-1.5">
                    <ProgressBar
                      value={
                        li.progressTarget > 0
                          ? (li.progressCurrent / li.progressTarget) * 100
                          : 0
                      }
                      color={goal.color}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Отвязать"
                  onClick={() => update(db.learningItems, li.id, { goalId: null })}
                  className="p-1.5 text-muted"
                >
                  <X size={16} />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <GoalEditSheet open={editOpen} onClose={() => setEditOpen(false)} goal={goal} />

      <TaskEditSheet
        open={taskSheetOpen}
        onClose={() => {
          setTaskSheetOpen(false);
          setEditingTask(null);
        }}
        task={editingTask}
        defaults={{ goalId: goal.id }}
      />

      <Sheet
        open={linkHabitOpen}
        onClose={() => setLinkHabitOpen(false)}
        title="Привязать привычку"
      >
        {availableHabits.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Нет привычек для привязки.</p>
        ) : (
          <div className="flex flex-col gap-2 pb-2">
            {availableHabits.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={async () => {
                  await update(db.habits, h.id, { goalId: goal.id });
                  setLinkHabitOpen(false);
                }}
                className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-3 text-left active:opacity-70"
              >
                <span className="text-xl">{h.emoji}</span>
                <span className="min-w-0 flex-1 truncate font-medium">{h.name}</span>
              </button>
            ))}
          </div>
        )}
      </Sheet>

      <Sheet
        open={linkLearningOpen}
        onClose={() => setLinkLearningOpen(false)}
        title="Привязать материал"
      >
        {availableLearning.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Нет материалов для привязки.</p>
        ) : (
          <div className="flex flex-col gap-2 pb-2">
            {availableLearning.map((li) => {
              const Icon = KIND_ICONS[li.kind];
              return (
                <button
                  key={li.id}
                  type="button"
                  onClick={async () => {
                    await update(db.learningItems, li.id, { goalId: goal.id });
                    setLinkLearningOpen(false);
                  }}
                  className="flex items-center gap-3 rounded-xl bg-surface-2 px-3.5 py-3 text-left active:opacity-70"
                >
                  <Icon size={18} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate font-medium">{li.title}</span>
                </button>
              );
            })}
          </div>
        )}
      </Sheet>
    </Screen>
  );
}
