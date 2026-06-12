import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BookOpen, FileText, GraduationCap, Video } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { LearningItem, LearningKind } from '../../db/types';
import { LearningItemSheet } from './LearningItemSheet';
import { ProgressStepper } from './ProgressStepper';

type Filter = 'inProgress' | 'planned' | 'done';

const KIND_ICONS: Record<LearningKind, LucideIcon> = {
  book: BookOpen,
  course: GraduationCap,
  article: FileText,
  video: Video,
};

const EMPTY_HINTS: Record<Filter, string> = {
  inProgress: 'Нажмите + и добавьте книгу, курс или статью.',
  planned: 'Сюда попадает то, что вы планируете изучить.',
  done: 'Завершённые материалы появятся здесь.',
};

function progressLabel(item: LearningItem): string {
  switch (item.progressUnit) {
    case 'pages':
      return `стр. ${item.progressCurrent} из ${item.progressTarget}`;
    case 'lessons':
      return `уроков ${item.progressCurrent} из ${item.progressTarget}`;
    case 'percent':
      return `${item.progressCurrent}%`;
  }
}

function LearningCard({ item, onOpen }: { item: LearningItem; onOpen: () => void }) {
  const Icon = KIND_ICONS[item.kind];
  const pct =
    item.progressTarget > 0 ? (100 * item.progressCurrent) / item.progressTarget : 0;
  return (
    <div
      onClick={onOpen}
      className="rounded-2xl border border-border bg-surface p-4 active:opacity-90"
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Icon size={20} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-semibold">{item.title}</p>
            {item.status === 'dropped' && (
              <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted">
                Брошено
              </span>
            )}
          </div>
          {item.author && <p className="truncate text-sm text-muted">{item.author}</p>}
        </div>
      </div>
      <div className="mt-3">
        <ProgressBar value={pct} />
        <p className="mt-1.5 text-xs text-muted">{progressLabel(item)}</p>
      </div>
      {item.status === 'inProgress' && (
        <div className="mt-2">
          <ProgressStepper item={item} />
        </div>
      )}
    </div>
  );
}

export function LearningPage() {
  const [filter, setFilter] = useState<Filter>('inProgress');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<LearningItem | null>(null);

  const rows = useLiveQuery(() => db.learningItems.toArray(), []);
  const items = alive(rows ?? [])
    .filter((i) =>
      filter === 'done' ? i.status === 'done' || i.status === 'dropped' : i.status === filter,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const openCreate = () => {
    setEditing(null);
    setSheetOpen(true);
  };

  const openEdit = (item: LearningItem) => {
    setEditing(item);
    setSheetOpen(true);
  };

  return (
    <Screen title="Обучение" backTo="/more">
      <div className="space-y-3">
        <SegmentedControl<Filter>
          options={[
            { value: 'inProgress', label: 'В процессе' },
            { value: 'planned', label: 'В планах' },
            { value: 'done', label: 'Завершено' },
          ]}
          value={filter}
          onChange={setFilter}
        />
        {items.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="Пока ничего нет"
            hint={EMPTY_HINTS[filter]}
          />
        ) : (
          items.map((item) => (
            <LearningCard key={item.id} item={item} onOpen={() => openEdit(item)} />
          ))
        )}
      </div>
      <Fab onClick={openCreate} />
      <LearningItemSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        item={editing}
      />
    </Screen>
  );
}
