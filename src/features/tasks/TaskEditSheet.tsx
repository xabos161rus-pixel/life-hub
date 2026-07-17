import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { CircleX, Copy, ImagePlus, ListOrdered, Timer, X } from 'lucide-react';
import { db } from '../../db/db';
import { alive, create, remove, uid, update } from '../../db/repo';
import type { ChecklistItem, Priority, Project, Recurrence, Task } from '../../db/types';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { ClearFieldButton, Field, Input } from '../../components/ui/Input';
import { Hint } from '../../components/ui/Hint';
import { useToast } from '../../components/ui/Toast';
import { Chip, ChipRow } from '../../components/ui/Chip';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { TaskCheck } from '../../components/ui/Checkbox';
import { MicButton } from '../../components/ui/MicButton';
import { addDaysKey, todayKey, WEEKDAY_LABELS } from '../../lib/dates';
import { PRESET_COLORS } from '../../lib/colors';
import { cancelReminder, scheduleReminder } from '../../lib/push';
import { compressImage } from '../../lib/image';
import { usePomodoro } from '../focus/PomodoroProvider';

type RecType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
type PriorityStr = '0' | '1' | '2' | '3';

const selectClass =
  'w-full appearance-none rounded-xl bg-surface-2 border border-border px-3.5 py-3 text-text outline-none focus:border-accent';

// Стили Input для авто-grow textarea названия (#7) — компонент Textarea не
// прокидывает ref, поэтому используем нативный textarea с теми же классами.
const inputBase =
  'w-full rounded-xl bg-surface-2 border border-hairline px-3.5 py-3 text-text placeholder:text-muted outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-2 focus:ring-accent/25';

const PRIORITY_OPTIONS: { value: PriorityStr; label: string }[] = [
  { value: '0', label: 'Нет' },
  { value: '1', label: 'Низкий' },
  { value: '2', label: 'Средний' },
  { value: '3', label: 'Высокий' },
];

const REC_OPTIONS: { value: RecType; label: string }[] = [
  { value: 'none', label: 'Нет' },
  { value: 'daily', label: 'День' },
  { value: 'weekly', label: 'Неделя' },
  { value: 'monthly', label: 'Месяц' },
  { value: 'yearly', label: 'Год' },
];

const REC_INTERVAL_LABELS: Record<Exclude<RecType, 'none'>, string> = {
  daily: 'Интервал (дней)',
  weekly: 'Интервал (недель)',
  monthly: 'Интервал (месяцев)',
  yearly: 'Интервал (лет)',
};

// Длительность — от 5 минут до 24 часов (мелкий шаг в начале, крупный дальше).
const DURATION_PRESETS = [
  5, 10, 15, 20, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360, 480, 600, 720, 900, 1080, 1440,
];
// Напоминание — за сколько до начала, вплоть до суток.
const REMIND_PRESETS = [5, 10, 15, 30, 45, 60, 120, 180, 360, 720, 1440];

/** Человекочитаемая длительность: «15м», «1ч», «1ч 30м». */
function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}м`;
  return m === 0 ? `${h}ч` : `${h}ч ${m}м`;
}

/** Шит создания/редактирования задачи. task=null → создание с defaults. */
export function TaskEditSheet({
  open,
  onClose,
  task,
  defaults,
}: {
  open: boolean;
  onClose: () => void;
  task?: Task | null;
  defaults?: { projectId?: string | null; goalId?: string | null; dueDate?: string | null };
}) {
  const projectsRaw = useLiveQuery(
    async () =>
      alive(await db.projects.toArray())
        .filter((p) => !p.archivedAt)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [],
  );
  // Стабильная ссылка для useMemo ниже: «?? []» на каждый рендер давал бы
  // новую идентичность и пересчёт orderedProjects впустую.
  const projects = useMemo(() => projectsRaw ?? [], [projectsRaw]);
  const goals =
    useLiveQuery(
      async () => alive(await db.goals.toArray()).filter((g) => g.status === 'active'),
      [],
    ) ?? [];

  const toast = useToast();
  const navigate = useNavigate();
  const pomodoro = usePomodoro();
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);

  const handleFocus = () => {
    if (!task) return;
    pomodoro.start(task.id, title.trim() || task.title);
    onClose();
    navigate('/more/focus');
  };

  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [projectId, setProjectId] = useState<string | null>(null);
  const [goalId, setGoalId] = useState<string | null>(null);
  const [priority, setPriority] = useState<Priority>(0);
  const [dueDate, setDueDate] = useState<string | null>(null);
  const [dueTime, setDueTime] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [remindBefore, setRemindBefore] = useState<number | null>(null);
  const [recType, setRecType] = useState<RecType>('none');
  const [recInterval, setRecInterval] = useState('1');
  const [recWeekdays, setRecWeekdays] = useState<number[]>([]);
  const [recDayOfMonth, setRecDayOfMonth] = useState('1');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [newItem, setNewItem] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  // Просмотр фото на весь экран (null — закрыт).
  const [viewPhoto, setViewPhoto] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Проекты в порядке иерархии: верхний уровень, за ним его подпроекты с отступом.
  const orderedProjects = useMemo(() => {
    const ids = new Set(projects.map((p) => p.id));
    const tops = projects.filter((p) => !p.parentId || !ids.has(p.parentId));
    const out: { p: Project; depth: number }[] = [];
    for (const t of tops) {
      out.push({ p: t, depth: 0 });
      for (const c of projects.filter((x) => x.parentId === t.id)) out.push({ p: c, depth: 1 });
    }
    return out;
  }, [projects]);

  // Инлайн-создание проекта прямо из шита задачи (#1).
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectColor, setNewProjectColor] = useState(PRESET_COLORS[0]);
  const [newProjectEmoji, setNewProjectEmoji] = useState('📁');

  // Инициализация формы при каждом открытии шита.
  useEffect(() => {
    if (!open) return;
    if (task) {
      setTitle(task.title);
      setNotes(task.notes);
      setTagsText(task.tags.join(', '));
      setProjectId(task.projectId);
      setGoalId(task.goalId);
      setPriority(task.priority);
      setDueDate(task.dueDate);
      setDueTime(task.dueTime ?? null);
      setDuration(task.duration ?? null);
      setRemindBefore(task.remindBefore ?? null);
      setChecklist(task.checklist.map((i) => ({ ...i })));
      setPhotos(task.photos ? [...task.photos] : []);
      const rec = task.recurrence;
      setRecType(rec?.type ?? 'none');
      setRecInterval(String(rec?.interval ?? 1));
      setRecWeekdays(rec?.type === 'weekly' ? [...rec.weekdays] : []);
      setRecDayOfMonth(String(rec?.type === 'monthly' ? rec.dayOfMonth : 1));
    } else {
      setTitle('');
      setNotes('');
      setTagsText('');
      setProjectId(defaults?.projectId ?? null);
      setGoalId(defaults?.goalId ?? null);
      setPriority(0);
      setDueDate(defaults?.dueDate ?? null);
      setDueTime(null);
      setDuration(null);
      setRemindBefore(null);
      setChecklist([]);
      setPhotos([]);
      setRecType('none');
      setRecInterval('1');
      setRecWeekdays([]);
      setRecDayOfMonth('1');
    }
    setNewItem('');
    setViewPhoto(null);
    setShowNewProject(false);
    setNewProjectName('');
    setNewProjectColor(PRESET_COLORS[0]);
    setNewProjectEmoji('📁');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Авто-подгон высоты поля названия под содержимое (#7). Реагирует на
  // программные изменения title (mic/инициализация) и на открытие шита.
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [title, open]);

  // Авто-подгон высоты поля заметок — поле растёт за текстом (без внутреннего
  // скролла), а лента шита держит курсор в зоне видимости: текст больше не
  // уходит в невидимый край, и при создании, и при просмотре виден целиком.
  useEffect(() => {
    const el = notesRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [notes, open]);

  const buildRecurrence = (): Recurrence | null => {
    const interval = Math.max(1, parseInt(recInterval, 10) || 1);
    switch (recType) {
      case 'none':
        return null;
      case 'daily':
        return { type: 'daily', interval };
      case 'weekly':
        return { type: 'weekly', interval, weekdays: [...recWeekdays].sort((a, b) => a - b) };
      case 'monthly':
        return {
          type: 'monthly',
          interval,
          dayOfMonth: Math.min(31, Math.max(1, parseInt(recDayOfMonth, 10) || 1)),
        };
      case 'yearly':
        return { type: 'yearly', interval };
    }
  };

  const savingRef = useRef(false);
  const handleSave = async () => {
    if (savingRef.current) return; // защита от дабл-тапа: не плодим дубликаты
    savingRef.current = true;
    try {
      const data = {
        title: title.trim(),
        notes: notes.trim(),
        projectId,
        goalId,
        priority,
        dueDate,
        dueTime: dueDate ? dueTime : null,
        duration: dueDate ? duration : null,
        remindBefore: dueDate ? remindBefore : null,
        checklist,
        photos,
        recurrence: buildRecurrence(),
        tags: tagsText
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      };
      let savedId: string;
      if (task) {
        await update(db.tasks, task.id, data);
        savedId = task.id;
      } else {
        const created = await create(db.tasks, { ...data, completedAt: null, sortOrder: Date.now() });
        savedId = created.id;
      }
      // Поставить/обновить пуш-напоминание (внутри само снимет, если срок/время убраны).
      void scheduleReminder({
        id: savedId,
        title: data.title,
        dueDate: data.dueDate,
        dueTime: data.dueTime,
        remindBefore: data.remindBefore,
      });
      onClose();
    } finally {
      savingRef.current = false;
    }
  };

  const handleDelete = async () => {
    if (!task) return;
    if (!window.confirm('Удалить задачу?')) return;
    void cancelReminder(task.id);
    await remove(db.tasks, task.id);
    onClose();
  };

  const handleCreateProject = async () => {
    const name = newProjectName.trim();
    if (!name) return;
    const project = await create(db.projects, {
      name,
      color: newProjectColor,
      emoji: newProjectEmoji.trim() || '📁',
      sortOrder: Date.now(),
      archivedAt: null,
    });
    setProjectId(project.id);
    setShowNewProject(false);
    setNewProjectName('');
    setNewProjectColor(PRESET_COLORS[0]);
    setNewProjectEmoji('📁');
  };

  const addChecklistItem = () => {
    const text = newItem.trim();
    if (!text) return;
    setChecklist((items) => [...items, { id: uid(), text, done: false }]);
    setNewItem('');
  };

  // Добавление фото: сжимаем в JPEG dataURL (как в «Местах»/чате), чтобы не
  // раздувать IndexedDB и полезную нагрузку синка.
  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    const added: string[] = [];
    for (const f of Array.from(files).slice(0, 10)) {
      try {
        added.push(await compressImage(f, 1280, 0.72));
      } catch {
        /* нечитаемый файл — пропускаем */
      }
    }
    if (added.length) setPhotos((prev) => [...prev, ...added]);
  };

  const handleNewItemKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addChecklistItem();
    }
  };

  // Enter в поле названия не сабмитит — даём перенос строки (#7).
  const handleTitleKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) e.stopPropagation();
  };

  // Автонумерация в заметках: Enter после строки «N. текст» добавляет «(N+1). »;
  // Enter на пустом пункте «N. » — выходит из списка (убирает маркер).
  const handleNotesKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey) return;
    const ta = e.currentTarget;
    const { selectionStart, selectionEnd, value } = ta;
    if (selectionStart !== selectionEnd) return; // есть выделение — обычный Enter
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const line = value.slice(lineStart, selectionStart);
    const m = /^(\s*)(\d+)\.\s(.*)$/.exec(line);
    if (!m) return; // строка не вида «N. …» — обычный перенос
    e.preventDefault();
    const [, indent, numStr, rest] = m;
    if (rest.trim() === '') {
      const next = value.slice(0, lineStart) + value.slice(selectionStart);
      setNotes(next);
      requestAnimationFrame(() => ta.setSelectionRange(lineStart, lineStart));
      return;
    }
    const insert = `\n${indent}${Number(numStr) + 1}. `;
    const next = value.slice(0, selectionStart) + insert + value.slice(selectionEnd);
    setNotes(next);
    const pos = selectionStart + insert.length;
    requestAnimationFrame(() => ta.setSelectionRange(pos, pos));
  };

  const copyText = (text: string) => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    toast('Скопировано');
  };

  const tomorrow = addDaysKey(todayKey(), 1);

  return (
    <Sheet open={open} onClose={onClose} title={task ? 'Задача' : 'Новая задача'}>
      <div className="flex flex-col gap-4 pb-2">
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-muted">Название</span>
            <button
              type="button"
              aria-label="Скопировать название"
              onClick={() => copyText(title)}
              className="-mr-1 p-1 text-muted active:opacity-60"
            >
              <Copy size={15} />
            </button>
          </div>
          <div className="flex items-start gap-2">
            <div className="relative min-w-0 flex-1">
              {title.length > 0 && (
                <ClearFieldButton onClick={() => setTitle('')} className="top-3" />
              )}
              <textarea
                ref={titleRef}
                rows={1}
                value={title}
                placeholder="Что нужно сделать?"
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={handleTitleKey}
                className={`${inputBase} resize-none overflow-hidden`}
                style={title ? { paddingLeft: '2.5rem' } : undefined}
              />
            </div>
            <MicButton
              onText={(t) => setTitle((prev) => (prev ? `${prev} ${t}` : t))}
            />
          </div>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-muted">Заметки</span>
            <button
              type="button"
              aria-label="Скопировать заметки"
              onClick={() => copyText(notes)}
              className="-mr-1 p-1 text-muted active:opacity-60"
            >
              <Copy size={15} />
            </button>
          </div>
          <div className="flex items-start gap-2">
            <div className="relative min-w-0 flex-1">
              {notes.length > 0 && (
                <ClearFieldButton onClick={() => setNotes('')} className="top-3" />
              )}
              <textarea
                ref={notesRef}
                rows={2}
                value={notes}
                placeholder="Детали…"
                onChange={(e) => setNotes(e.target.value)}
                onKeyDown={handleNotesKey}
                className={`${inputBase} resize-none overflow-hidden whitespace-pre-wrap font-mono`}
                style={notes ? { paddingLeft: '2.5rem' } : undefined}
              />
            </div>
            <MicButton
              onText={(t) => setNotes((prev) => (prev ? `${prev} ${t}` : t))}
            />
          </div>
          <Hint
            id="task-notes-tricks"
            title="Удобный ввод"
            className="mt-2"
            items={[
              { icon: ListOrdered, text: <>Начните строку с «1. » — Enter продолжит нумерацию сам</> },
              { icon: CircleX, text: <>Крестик в начале текста стирает всё поле</> },
            ]}
          />
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-medium text-muted">Фото</span>
          <div className="flex flex-wrap gap-2">
            {photos.map((src, i) => (
              <div key={i} className="relative">
                <button type="button" onClick={() => setViewPhoto(src)} aria-label="Открыть фото">
                  <img
                    src={src}
                    alt=""
                    className="size-20 rounded-xl border border-hairline object-cover"
                  />
                </button>
                <button
                  type="button"
                  aria-label="Удалить фото"
                  onClick={() => setPhotos((prev) => prev.filter((_, j) => j !== i))}
                  className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border border-border bg-elevated text-muted active:opacity-60"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
            <button
              type="button"
              aria-label="Добавить фото"
              onClick={() => photoInputRef.current?.click()}
              className="flex size-20 items-center justify-center rounded-xl border border-dashed border-border text-muted active:opacity-60"
            >
              <ImagePlus size={22} />
            </button>
          </div>
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              void addPhotos(e.target.files);
              e.target.value = ''; // позволяет выбрать те же файлы повторно
            }}
          />
        </div>

        <Field label="Теги">
          <Input
            value={tagsText}
            placeholder="через запятую: работа, дом"
            onChange={(e) => setTagsText(e.target.value)}
            onClear={() => setTagsText('')}
          />
        </Field>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-medium text-muted">Проект</span>
            {!showNewProject && (
              <button
                type="button"
                className="text-sm font-medium text-accent"
                onClick={() => setShowNewProject(true)}
              >
                + Новый
              </button>
            )}
          </div>
          {showNewProject ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface p-3">
              <div className="flex items-center gap-2">
                <Input
                  value={newProjectEmoji}
                  placeholder="📁"
                  onChange={(e) => setNewProjectEmoji(e.target.value)}
                  className="w-14! shrink-0 text-center"
                />
                <Input
                  value={newProjectName}
                  placeholder="Название проекта"
                  autoFocus
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onClear={() => setNewProjectName('')}
                  className="min-w-0 flex-1"
                />
              </div>
              <div className="flex flex-wrap gap-2.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Цвет ${c}`}
                    onClick={() => setNewProjectColor(c)}
                    className="size-7 rounded-full transition-transform active:scale-90"
                    style={{
                      backgroundColor: c,
                      outline: newProjectColor === c ? `2px solid ${c}` : 'none',
                      outlineOffset: '2px',
                    }}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    setShowNewProject(false);
                    setNewProjectName('');
                  }}
                >
                  Отмена
                </Button>
                <Button
                  className="flex-1"
                  disabled={!newProjectName.trim()}
                  onClick={handleCreateProject}
                >
                  Создать
                </Button>
              </div>
            </div>
          ) : (
            <select
              className={selectClass}
              value={projectId ?? ''}
              onChange={(e) => setProjectId(e.target.value || null)}
            >
              <option value="">Без проекта</option>
              {orderedProjects.map(({ p, depth }) => (
                <option key={p.id} value={p.id}>
                  {depth > 0 ? '   ↳ ' : ''}
                  {p.emoji} {p.name}
                </option>
              ))}
            </select>
          )}
        </div>

        <Field label="Цель">
          <select
            className={selectClass}
            value={goalId ?? ''}
            onChange={(e) => setGoalId(e.target.value || null)}
          >
            <option value="">Без цели</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Приоритет">
          <SegmentedControl
            options={PRIORITY_OPTIONS}
            value={String(priority) as PriorityStr}
            onChange={(v) => setPriority(Number(v) as Priority)}
          />
        </Field>

        <div>
          <Field label="Срок">
            <Input
              type="date"
              value={dueDate ?? ''}
              onChange={(e) => setDueDate(e.target.value || null)}
            />
          </Field>
          <div className="mt-2">
            <ChipRow>
              <Chip active={dueDate === todayKey()} onClick={() => setDueDate(todayKey())}>
                Сегодня
              </Chip>
              <Chip active={dueDate === tomorrow} onClick={() => setDueDate(tomorrow)}>
                Завтра
              </Chip>
              <Chip
                onClick={() => {
                  setDueDate(null);
                  setDueTime(null);
                }}
              >
                Убрать
              </Chip>
            </ChipRow>
          </div>
        </div>

        {dueDate && (
          <>
            <Field label="Время начала">
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  className="flex-1"
                  value={dueTime ?? ''}
                  onChange={(e) => setDueTime(e.target.value || null)}
                />
                {dueTime && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      setDueTime(null);
                    }}
                    className="shrink-0 rounded-xl border border-border px-3.5 py-3 text-sm text-muted active:opacity-60"
                  >
                    Убрать
                  </button>
                )}
              </div>
            </Field>
            <Field label="Длительность">
              <select
                className={selectClass}
                value={duration ?? ''}
                onChange={(e) => setDuration(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">Нет</option>
                {DURATION_PRESETS.map((m) => (
                  <option key={m} value={m}>
                    {formatDuration(m)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Напоминание">
              <select
                className={selectClass}
                value={remindBefore ?? ''}
                onChange={(e) =>
                  setRemindBefore(e.target.value === '' ? null : Number(e.target.value))
                }
              >
                <option value="">Выкл</option>
                <option value="0">Вовремя</option>
                {REMIND_PRESETS.map((m) => (
                  <option key={m} value={m}>
                    за {formatDuration(m)}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}

        <Field label="Повторение">
          <SegmentedControl options={REC_OPTIONS} value={recType} onChange={setRecType} />
        </Field>

        {recType !== 'none' && (
          <Field label={REC_INTERVAL_LABELS[recType]}>
            <Input
              type="number"
              min={1}
              inputMode="numeric"
              value={recInterval}
              onChange={(e) => setRecInterval(e.target.value)}
            />
          </Field>
        )}

        {recType === 'weekly' && (
          <ChipRow>
            {WEEKDAY_LABELS.map((label, i) => {
              const day = i + 1;
              const on = recWeekdays.includes(day);
              return (
                <Chip
                  key={day}
                  active={on}
                  onClick={() =>
                    setRecWeekdays(
                      on ? recWeekdays.filter((d) => d !== day) : [...recWeekdays, day],
                    )
                  }
                >
                  {label}
                </Chip>
              );
            })}
          </ChipRow>
        )}

        {recType === 'monthly' && (
          <Field label="День месяца">
            <Input
              type="number"
              min={1}
              max={31}
              inputMode="numeric"
              value={recDayOfMonth}
              onChange={(e) => setRecDayOfMonth(e.target.value)}
            />
          </Field>
        )}

        <div>
          <span className="mb-1.5 block text-sm font-medium text-muted">Чеклист</span>
          {checklist.map((item) => (
            <div key={item.id} className="flex items-center gap-2.5 py-1">
              <TaskCheck
                size={22}
                checked={item.done}
                onChange={() =>
                  setChecklist((arr) =>
                    arr.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i)),
                  )
                }
              />
              <span className={`flex-1 text-sm ${item.done ? 'text-muted line-through' : ''}`}>
                {item.text}
              </span>
              <button
                aria-label="Удалить пункт"
                className="shrink-0 p-1 text-muted"
                onClick={() => setChecklist((arr) => arr.filter((i) => i.id !== item.id))}
              >
                <X size={16} />
              </button>
            </div>
          ))}
          <Input
            className="mt-1"
            value={newItem}
            placeholder="Добавить пункт"
            onChange={(e) => setNewItem(e.target.value)}
            onKeyDown={handleNewItemKey}
            onClear={() => setNewItem('')}
          />
        </div>

        {task && (
          <Button
            variant="secondary"
            className="flex w-full items-center justify-center gap-1.5"
            onClick={handleFocus}
          >
            <Timer size={17} /> Запустить фокус
          </Button>
        )}

        <div className="mt-1 flex gap-2">
          {task && (
            <Button variant="danger" onClick={handleDelete}>
              Удалить
            </Button>
          )}
          <Button className="flex-1" disabled={!title.trim()} onClick={handleSave}>
            Сохранить
          </Button>
        </div>
      </div>

      {/* Просмотр фото на весь экран — поверх шита, закрытие тапом. */}
      {viewPhoto && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/90 p-4"
          onClick={() => setViewPhoto(null)}
        >
          <img
            src={viewPhoto}
            alt=""
            className="max-h-full max-w-full rounded-xl object-contain"
          />
        </div>
      )}
    </Sheet>
  );
}
