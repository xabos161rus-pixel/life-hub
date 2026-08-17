// Исполнители инструментов: чтение реальных структур Dexie в компактный JSON.
//
// Важно не «что-то вернулось», а точные свойства: фильтры статуса и окна дат,
// поиск по тексту HTML-заметок, месячная математика финансов — то, на чём
// модель строит ответ. Соврёт инструмент — соврёт и ответ.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';

const { db } = await import('../../db/db');
const { runTool } = await import('./tools');

const base = { createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', deletedAt: null };
const task = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
  ...base,
  id,
  title,
  notes: '',
  projectId: null,
  goalId: null,
  priority: 0,
  dueDate: null,
  dueTime: null,
  duration: null,
  remindBefore: null,
  completedAt: null,
  checklist: [],
  recurrence: null,
  tags: [],
  sortOrder: 1000,
  ...extra,
});

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('list_tasks', () => {
  it('по умолчанию активные; completed и окно дат фильтруют', async () => {
    await db.tasks.bulkAdd([
      task('a', 'Активная без даты'),
      task('b', 'В окне', { dueDate: '2026-08-20' }),
      task('c', 'Вне окна', { dueDate: '2026-09-05' }),
      task('d', 'Сделана', { completedAt: '2026-08-10T10:00:00.000Z' }),
      task('e', 'Удалена', { deletedAt: '2026-08-10T10:00:00.000Z' }),
    ] as never[]);

    const active = JSON.parse((await runTool('list_tasks', '{}')).text) as { tasks: { title: string }[] };
    expect(active.tasks.map((t) => t.title).sort()).toEqual(['Активная без даты', 'В окне', 'Вне окна']);

    const windowed = JSON.parse(
      (await runTool('list_tasks', '{"from":"2026-08-15","to":"2026-08-31"}')).text,
    ) as { tasks: { title: string }[] };
    // Окно задано — задачи без даты не тащим: «что на этой неделе» ≠ бэклог.
    expect(windowed.tasks.map((t) => t.title)).toEqual(['В окне']);

    const done = JSON.parse((await runTool('list_tasks', '{"status":"completed"}')).text) as {
      tasks: { title: string }[];
    };
    expect(done.tasks.map((t) => t.title)).toEqual(['Сделана']);
  });

  it('проект подписывается именем, приоритет — словом', async () => {
    await db.projects.add({ ...base, id: 'p1', name: 'Работа', color: '#fff', emoji: '', sortOrder: 1, archivedAt: null } as never);
    await db.tasks.add(task('a', 'Отчёт', { projectId: 'p1', priority: 3 }) as never);
    const r = JSON.parse((await runTool('list_tasks', '{}')).text) as {
      tasks: { title: string; project?: string; priority?: string }[];
    };
    expect(r.tasks[0]).toMatchObject({ title: 'Отчёт', project: 'Работа', priority: 'high' });
  });
});

describe('заметки', () => {
  beforeEach(async () => {
    await db.notes.bulkAdd([
      {
        ...base,
        id: 'n1',
        title: 'Поставщик RTE',
        content: '<p>Контакт: Иван, отгрузка со склада в Люберцах</p>',
        tags: [],
        pinned: false,
      },
      { ...base, id: 'n2', title: 'Список книг', content: '<p>Прочитать до осени</p>', tags: [], pinned: true },
    ] as never[]);
  });

  it('search_notes ищет по тексту внутри HTML и отдаёт фрагмент', async () => {
    const r = JSON.parse((await runTool('search_notes', '{"query":"люберц"}')).text) as {
      notes: { title: string; snippet: string }[];
    };
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0].title).toBe('Поставщик RTE');
    expect(r.notes[0].snippet).toContain('Люберцах');
  });

  it('read_note находит по части заголовка и отдаёт текст без тегов', async () => {
    const r = JSON.parse((await runTool('read_note', '{"title":"поставщик"}')).text) as {
      title: string;
      text: string;
    };
    expect(r.title).toBe('Поставщик RTE');
    expect(r.text).toBe('Контакт: Иван, отгрузка со склада в Люберцах');
  });
});

describe('list_finance', () => {
  it('месячная сводка: weekly приводится к месяцу, неактивные не считаются', async () => {
    await db.expenseItems.bulkAdd([
      { ...base, id: 'e1', title: 'Аренда', amount: 60000, kind: 'expense', category: 'Жильё', recurrence: 'monthly', dayOfMonth: 5, notes: '', active: true, sortOrder: 1 },
      { ...base, id: 'e2', title: 'Бассейн', amount: 1000, kind: 'expense', category: 'Спорт', recurrence: 'weekly', dayOfMonth: null, notes: '', active: true, sortOrder: 2 },
      { ...base, id: 'e3', title: 'Старая подписка', amount: 500, kind: 'expense', category: '', recurrence: 'monthly', dayOfMonth: null, notes: '', active: false, sortOrder: 3 },
      { ...base, id: 'e4', title: 'Зарплата', amount: 90000, kind: 'income', category: '', recurrence: 'monthly', dayOfMonth: 10, notes: '', active: true, sortOrder: 4 },
    ] as never[]);
    const r = JSON.parse((await runTool('list_finance', '{}')).text) as {
      items: { title: string }[];
      monthlyExpense: number;
      monthlyIncome: number;
    };
    expect(r.items.map((i) => i.title).sort()).toEqual(['Аренда', 'Бассейн', 'Зарплата']);
    // 60000 + 1000×52/12 ≈ 64333
    expect(r.monthlyExpense).toBe(Math.round(60000 + (1000 * 52) / 12));
    expect(r.monthlyIncome).toBe(90000);
  });
});

describe('cycle_summary', () => {
  const settings = (lock: 'none' | 'pin') => ({
    id: 'app',
    mode: 'tracking',
    predictionsEnabled: true,
    fertilityDisplay: 'off',
    dayStartHour: 0,
    lock,
    hideFromNavigation: false,
    showOnTodayScreen: false,
    neutralNotificationText: true,
    includeInGeneralBackup: false,
    syncEnabled: false,
    integrations: {
      todayCard: false,
      calendarMarks: false,
      energyCorrelation: false,
      habitsCorrelation: false,
      autoTasks: false,
      planningHints: false,
    },
    updatedAt: '2026-08-01T00:00:00.000Z',
  });

  const day = (date: string, extra: Record<string, unknown>) => ({
    date,
    isBleedingDay: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    source: 'user',
    ...extra,
  });

  it('отдаёт цикл, прогноз и отметки; симптомы — подписями; intimacy не утекает', async () => {
    await db.cycleSettings.put(settings('none') as never);
    await db.cycles.bulkAdd([
      { startDate: '2026-07-15', endDate: '2026-08-11', lengthDays: 28, periodLengthDays: 5, status: 'complete', excluded: 0 },
      { startDate: '2026-08-12', status: 'current', excluded: 0 },
    ] as never[]);
    await db.cyclePredictions.add({
      forCycleStart: '2026-08-12',
      predictedNextStart: '2026-09-09',
      lo50: '2026-09-08',
      hi50: '2026-09-10',
      lo80: '2026-09-06',
      hi80: '2026-09-12',
    } as never);
    await db.cycleSymptoms.add({ key: 'headache', group: 'somatic', label: 'Головная боль' } as never);
    const recent = new Date();
    recent.setDate(recent.getDate() - 2);
    const rkey = `${recent.getFullYear()}-${String(recent.getMonth() + 1).padStart(2, '0')}-${String(recent.getDate()).padStart(2, '0')}`;
    await db.cycleDays.add(
      day(rkey, {
        bleeding: 'medium',
        isBleedingDay: 1,
        symptoms: [{ key: 'headache', severity: 2 }],
        intimacy: { count: 1, protection: 'protected' },
      }) as never,
    );

    const r = JSON.parse((await runTool('cycle_summary', '{}')).text) as {
      currentCycle: { start: string; day: number };
      recentCycles: { length: number }[];
      prediction?: { nextStart: string };
      days: Record<string, unknown>[];
    };
    expect(r.currentCycle.start).toBe('2026-08-12');
    expect(r.currentCycle.day).toBeGreaterThan(0);
    expect(r.recentCycles).toEqual([{ start: '2026-07-15', length: 28, period: 5 }]);
    expect(r.prediction?.nextStart).toBe('2026-09-09');
    expect(r.days).toHaveLength(1);
    expect(r.days[0].symptoms).toEqual(['Головная боль']);
    // Интимный слой не должен просочиться ни под каким именем.
    expect(JSON.stringify(r)).not.toContain('intimacy');
    expect(JSON.stringify(r)).not.toContain('protected');
  });

  it('код доступа на разделе закрывает и доступ ИИ', async () => {
    await db.cycleSettings.put(settings('pin') as never);
    await db.cycleDays.add(day('2026-08-15', { bleeding: 'light', isBleedingDay: 1 }) as never);
    const r = JSON.parse((await runTool('cycle_summary', '{}')).text) as { error?: string };
    expect(r.error).toContain('кодом доступа');
    expect(JSON.stringify(r)).not.toContain('light');
  });

  it('раздел не настроен — честная ошибка, не пустая сводка', async () => {
    const r = JSON.parse((await runTool('cycle_summary', '{}')).text) as { error?: string };
    expect(r.error).toContain('не настроен');
  });
});

describe('устойчивость', () => {
  it('битые аргументы не роняют вызов — работаем с пустыми', async () => {
    const r = await runTool('list_tasks', '{оборванный json');
    expect(() => JSON.parse(r.text)).not.toThrow();
  });

  it('неизвестный инструмент — ошибка в content, не исключение', async () => {
    const r = await runTool('take_over_the_world', '{}');
    expect(JSON.parse(r.text)).toMatchObject({ error: expect.stringContaining('неизвестный') });
  });
});
