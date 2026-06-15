import { useMemo, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  BatteryCharging,
  Gauge,
  ListTodo,
  MapPin,
  Search,
  SearchX,
  StickyNote,
  Target,
  GraduationCap,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { db } from '../../db/db';
import { alive } from '../../db/repo';

const PER_SECTION = 8;

/** HTML заметки → плоский текст для поиска и контекста (теги убираем regex-ом). */
function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Hit {
  id: string;
  to: string;
  title: string;
  context: string;
}

interface SectionResult {
  key: string;
  label: string;
  icon: LucideIcon;
  hits: Hit[];
  total: number;
}

function Row({ icon: Icon, hit }: { icon: LucideIcon; hit: Hit }) {
  return (
    <Link to={hit.to} className="flex items-start gap-3 px-4 py-3 active:opacity-70">
      <Icon size={18} className="mt-0.5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{hit.title || 'Без названия'}</p>
        {hit.context && <p className="truncate text-sm text-muted">{hit.context}</p>}
      </div>
    </Link>
  );
}

export function SearchPage() {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const tasks = useLiveQuery(() => db.tasks.toArray(), []);
  const notes = useLiveQuery(() => db.notes.toArray(), []);
  const goals = useLiveQuery(() => db.goals.toArray(), []);
  const places = useLiveQuery(() => db.placeItems.toArray(), []);
  const learning = useLiveQuery(() => db.learningItems.toArray(), []);
  const metrics = useLiveQuery(() => db.metrics.toArray(), []);
  const energy = useLiveQuery(() => db.energyItems.toArray(), []);
  const expenses = useLiveQuery(() => db.expenseItems.toArray(), []);

  const sections = useMemo<SectionResult[]>(() => {
    if (!q) return [];

    const build = (
      key: string,
      label: string,
      icon: LucideIcon,
      all: Hit[],
    ): SectionResult => ({ key, label, icon, hits: all.slice(0, PER_SECTION), total: all.length });

    const taskHits: Hit[] = alive(tasks ?? [])
      .filter((t) => `${t.title}\n${t.notes}`.toLowerCase().includes(q))
      .map((t) => ({ id: t.id, to: '/tasks', title: t.title, context: t.notes }));

    const noteHits: Hit[] = alive(notes ?? [])
      .map((n) => ({ note: n, text: htmlToText(n.content) }))
      .filter(({ note, text }) => `${note.title}\n${text}`.toLowerCase().includes(q))
      .map(({ note, text }) => ({
        id: note.id,
        to: `/notes/${note.id}`,
        title: note.title || text.split(' ').slice(0, 6).join(' '),
        context: text,
      }));

    const goalHits: Hit[] = alive(goals ?? [])
      .filter((g) => `${g.title}\n${g.description}`.toLowerCase().includes(q))
      .map((g) => ({ id: g.id, to: `/goals/${g.id}`, title: g.title, context: g.description }));

    const placeHits: Hit[] = alive(places ?? [])
      .filter((p) => `${p.title}\n${p.description}\n${p.source}`.toLowerCase().includes(q))
      .map((p) => ({ id: p.id, to: '/more/places', title: p.title, context: p.description }));

    const learningHits: Hit[] = alive(learning ?? [])
      .filter((l) => `${l.title}\n${l.author}`.toLowerCase().includes(q))
      .map((l) => ({ id: l.id, to: '/more/learning', title: l.title, context: l.author }));

    const metricHits: Hit[] = alive(metrics ?? [])
      .filter((m) => m.title.toLowerCase().includes(q))
      .map((m) => ({ id: m.id, to: '/more/metrics', title: m.title, context: m.unit }));

    const energyHits: Hit[] = alive(energy ?? [])
      .filter((e) => `${e.title}\n${e.description}`.toLowerCase().includes(q))
      .map((e) => ({ id: e.id, to: '/more/energy', title: e.title, context: e.description }));

    const expenseHits: Hit[] = alive(expenses ?? [])
      .filter((x) => `${x.title}\n${x.category}`.toLowerCase().includes(q))
      .map((x) => ({ id: x.id, to: '/more/finance', title: x.title, context: x.category }));

    return [
      build('tasks', 'Задачи', ListTodo, taskHits),
      build('notes', 'Заметки', StickyNote, noteHits),
      build('goals', 'Цели', Target, goalHits),
      build('places', 'Места', MapPin, placeHits),
      build('learning', 'Обучение', GraduationCap, learningHits),
      build('metrics', 'Метрики', Gauge, metricHits),
      build('energy', 'Энергия', BatteryCharging, energyHits),
      build('expenses', 'Финансы', Wallet, expenseHits),
    ].filter((s) => s.total > 0);
  }, [q, tasks, notes, goals, places, learning, metrics, energy, expenses]);

  return (
    <Screen title="Поиск" backTo="/">
      <div className="relative mb-4">
        <Search
          size={18}
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
        />
        <Input
          autoFocus
          value={query}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
          placeholder="Искать везде…"
          className="pl-10"
        />
      </div>

      {!q ? (
        <p className="px-1 text-sm text-muted">Введите запрос</p>
      ) : sections.length === 0 ? (
        <EmptyState icon={SearchX} title="Ничего не найдено" hint="Попробуйте другой запрос" />
      ) : (
        <div className="space-y-5">
          {sections.map((s) => (
            <section key={s.key}>
              <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">
                {s.label} · {s.total}
              </h2>
              <div className="card divide-y divide-hairline">
                {s.hits.map((hit) => (
                  <Row key={hit.id} icon={s.icon} hit={hit} />
                ))}
              </div>
              {s.total > s.hits.length && (
                <p className="mt-1.5 px-1 text-sm text-muted">
                  и ещё {s.total - s.hits.length}
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </Screen>
  );
}
