import { useMemo, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ExternalLink,
  Lightbulb,
  MapPin,
  Package,
  Plane,
  Search,
  UtensilsCrossed,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { Chip, ChipRow } from '../../components/ui/Chip';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { PlaceItem, PlaceKind, PlaceStatus } from '../../db/types';
import { PlaceSheet } from './PlaceSheet';

const KIND_ICONS: Record<PlaceKind, LucideIcon> = {
  place: MapPin,
  thing: Package,
  tip: Lightbulb,
  food: UtensilsCrossed,
  travel: Plane,
};

const KIND_LABELS: Record<PlaceKind, string> = {
  place: 'Места',
  thing: 'Вещи',
  tip: 'Советы',
  food: 'Еда',
  travel: 'Путешествия',
};

const STATUS_LABELS: Record<PlaceStatus, string> = {
  idea: 'Идея',
  want: 'Хочу',
  done: 'Был',
};

const KIND_ORDER: PlaceKind[] = ['place', 'thing', 'tip', 'food', 'travel'];

/** Открывает адрес в Картах (на iPhone/Mac — приложение Apple Карты). */
function openMaps(location: string) {
  window.open(`https://maps.apple.com/?q=${encodeURIComponent(location)}`, '_blank', 'noopener');
}

type KindFilter = 'all' | PlaceKind;

function PlaceCard({ item, onOpen }: { item: PlaceItem; onOpen: () => void }) {
  const Icon = KIND_ICONS[item.kind];
  return (
    <div
      onClick={onOpen}
      className="overflow-hidden rounded-2xl border border-hairline bg-surface active:opacity-90"
    >
      {item.photo && <img src={item.photo} alt="" className="h-40 w-full object-cover" />}
      <div className="flex items-start gap-3 p-4">
        {item.location ? (
          <button
            type="button"
            aria-label="Открыть на карте"
            onClick={(e) => {
              e.stopPropagation();
              openMaps(item.location);
            }}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent active:opacity-70"
          >
            <MapPin size={20} />
          </button>
        ) : (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
            <Icon size={20} />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 font-semibold">{item.title}</p>
            <span
              className={`shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] ${
                item.status === 'done' ? 'text-success' : 'text-muted'
              }`}
            >
              {STATUS_LABELS[item.status]}
            </span>
          </div>
          {item.description && (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted">{item.description}</p>
          )}
          {item.source && (
            <p className="mt-1 text-xs text-muted">от {item.source}</p>
          )}
          {item.location && (
            <p className="mt-1 flex items-center gap-1 text-xs text-muted">
              <MapPin size={12} className="shrink-0" />
              <span className="truncate">{item.location}</span>
            </p>
          )}
          {item.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
          {item.link && (
            <a
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-accent active:opacity-60"
            >
              <ExternalLink size={14} />
              Открыть ссылку
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export function PlacesPage() {
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [query, setQuery] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<PlaceItem | null>(null);

  const rows = useLiveQuery<PlaceItem[]>(() => db.placeItems.toArray(), []);
  const all = useMemo(() => alive(rows ?? []), [rows]);

  const q = query.trim().toLowerCase();
  const items = useMemo(
    () =>
      all
        .filter((i) => (kindFilter === 'all' ? true : i.kind === kindFilter))
        .filter((i) =>
          !q
            ? true
            : `${i.title}\n${i.description}\n${i.source}`.toLowerCase().includes(q),
        )
        .sort((a, b) => b.sortOrder - a.sortOrder),
    [all, kindFilter, q],
  );

  const openCreate = () => {
    setEditing(null);
    setSheetOpen(true);
  };

  const openEdit = (item: PlaceItem) => {
    setEditing(item);
    setSheetOpen(true);
  };

  return (
    <Screen title="Места и путешествия" backTo="/more">
      <div className="space-y-3">
        <ChipRow>
          <Chip active={kindFilter === 'all'} onClick={() => setKindFilter('all')}>
            Все
          </Chip>
          {KIND_ORDER.map((k) => (
            <Chip key={k} active={kindFilter === k} onClick={() => setKindFilter(k)}>
              {KIND_LABELS[k]}
            </Chip>
          ))}
        </ChipRow>

        <div className="relative">
          <Search
            size={18}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
          />
          <Input
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder="Поиск"
            className="pl-10"
          />
        </div>

        {items.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="Пока ничего нет"
            hint={
              all.length === 0
                ? 'Сохраняйте места, вещи и советы, чтобы не забыть.'
                : 'Ничего не найдено. Попробуйте другой запрос или фильтр.'
            }
          />
        ) : (
          items.map((item) => (
            <PlaceCard key={item.id} item={item} onOpen={() => openEdit(item)} />
          ))
        )}
      </div>

      <Fab onClick={openCreate} />
      <PlaceSheet open={sheetOpen} onClose={() => setSheetOpen(false)} item={editing} />
    </Screen>
  );
}
