import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BatteryCharging,
  FolderKanban,
  Gauge,
  GraduationCap,
  ListTodo,
  MapPin,
  RotateCcw,
  StickyNote,
  Target,
  Trash2,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Table } from 'dexie';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../components/ui/Toast';
import { db } from '../../db/db';
import { update } from '../../db/repo';
import { formatRu } from '../../lib/dates';
import type { BaseEntity } from '../../db/types';

interface TrashEntry {
  table: Table<BaseEntity, string>;
  tableName: string;
  id: string;
  title: string;
  deletedAt: string;
  icon: LucideIcon;
}

export function TrashPage() {
  const toast = useToast();

  const tasks = useLiveQuery<BaseEntity[]>(() => db.tasks.toArray(), []) ?? [];
  const notes = useLiveQuery<BaseEntity[]>(() => db.notes.toArray(), []) ?? [];
  const goals = useLiveQuery<BaseEntity[]>(() => db.goals.toArray(), []) ?? [];
  const projects = useLiveQuery<BaseEntity[]>(() => db.projects.toArray(), []) ?? [];
  const learning = useLiveQuery<BaseEntity[]>(() => db.learningItems.toArray(), []) ?? [];
  const expenses = useLiveQuery<BaseEntity[]>(() => db.expenseItems.toArray(), []) ?? [];
  const energy = useLiveQuery<BaseEntity[]>(() => db.energyItems.toArray(), []) ?? [];
  const places = useLiveQuery<BaseEntity[]>(() => db.placeItems.toArray(), []) ?? [];
  const metrics = useLiveQuery<BaseEntity[]>(() => db.metrics.toArray(), []) ?? [];

  const entries = useMemo<TrashEntry[]>(() => {
    const collect = (
      table: Table<BaseEntity, string>,
      tableName: string,
      icon: LucideIcon,
      rows: BaseEntity[],
      titleOf: (row: Record<string, unknown>) => string,
    ): TrashEntry[] =>
      rows
        .filter((r): r is BaseEntity & { deletedAt: string } => r.deletedAt != null)
        .map((r) => ({
          table,
          tableName,
          id: r.id,
          title: titleOf(r as unknown as Record<string, unknown>),
          deletedAt: r.deletedAt,
          icon,
        }));

    const str = (v: unknown): string => (typeof v === 'string' ? v : '');

    return [
      ...collect(db.tasks, 'tasks', ListTodo, tasks, (r) => str(r.title)),
      ...collect(db.notes, 'notes', StickyNote, notes, (r) => str(r.title) || 'Без названия'),
      ...collect(db.goals, 'goals', Target, goals, (r) => str(r.title)),
      ...collect(db.projects, 'projects', FolderKanban, projects, (r) => str(r.name)),
      ...collect(db.learningItems, 'learningItems', GraduationCap, learning, (r) => str(r.title)),
      ...collect(db.expenseItems, 'expenseItems', Wallet, expenses, (r) => str(r.title)),
      ...collect(db.energyItems, 'energyItems', BatteryCharging, energy, (r) => str(r.title)),
      ...collect(db.placeItems, 'placeItems', MapPin, places, (r) => str(r.title)),
      ...collect(db.metrics, 'metrics', Gauge, metrics, (r) => str(r.title)),
    ].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }, [tasks, notes, goals, projects, learning, expenses, energy, places, metrics]);

  async function handleRestore(entry: TrashEntry) {
    await update(entry.table, entry.id, { deletedAt: null });
    toast('Восстановлено');
  }

  async function handlePurge(entry: TrashEntry) {
    if (!window.confirm('Удалить навсегда?')) return;
    await db.table(entry.tableName).delete(entry.id);
    toast('Удалено навсегда');
  }

  return (
    <Screen title="Корзина" backTo="/more/settings">
      {entries.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="Корзина пуста"
          hint="Удалённые записи появляются здесь и хранятся до окончательного удаления."
        />
      ) : (
        <div className="space-y-4">
          <div className="card p-4 text-sm leading-relaxed text-muted">
            Здесь удалённые записи. Их можно восстановить или удалить навсегда.
          </div>
          <div className="card divide-y divide-hairline">
            {entries.map((entry) => {
              const Icon = entry.icon;
              return (
                <div key={`${entry.tableName}-${entry.id}`} className="flex items-center gap-3 px-4 py-3">
                  <Icon size={18} className="mt-0.5 shrink-0 self-start text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{entry.title || 'Без названия'}</p>
                    <p className="text-sm text-muted">
                      удалено {formatRu(entry.deletedAt.slice(0, 10))}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    className="shrink-0 px-3 py-2 text-sm"
                    onClick={() => void handleRestore(entry)}
                  >
                    <span className="flex items-center gap-1.5">
                      <RotateCcw size={16} />
                      Восстановить
                    </span>
                  </Button>
                  <button
                    aria-label="Удалить навсегда"
                    className="shrink-0 p-2 text-muted active:opacity-60"
                    onClick={() => void handlePurge(entry)}
                  >
                    <Trash2 size={18} className="text-danger" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Screen>
  );
}
