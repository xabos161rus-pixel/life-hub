import { useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pin, Search, StickyNote } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Fab } from '../../components/layout/Fab';
import { Screen } from '../../components/layout/Screen';
import { Chip, ChipRow } from '../../components/ui/Chip';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input } from '../../components/ui/Input';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import type { Note } from '../../db/types';
import { formatRu, toKey } from '../../lib/dates';

/** Грубо снимает markdown-разметку для превью карточки. */
function stripMd(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/(\*\*|__|~~|\*|_)/g, '')
    .trim();
}

function NoteCard({ note, onOpen }: { note: Note; onOpen: () => void }) {
  const preview = stripMd(note.content);
  return (
    <button
      onClick={onOpen}
      className="flex flex-col items-stretch rounded-2xl border border-border bg-surface p-3.5 text-left active:opacity-80"
    >
      <div className="flex items-start gap-1.5">
        {note.pinned && <Pin size={14} className="mt-1 shrink-0 text-accent" />}
        <p className="line-clamp-2 font-bold leading-snug">{note.title || 'Без названия'}</p>
      </div>
      {preview && (
        <p className="mt-1 line-clamp-4 text-sm leading-snug whitespace-pre-line text-muted">
          {preview}
        </p>
      )}
      {note.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {note.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
      <p className="mt-2 text-[11px] text-muted/70">
        {formatRu(toKey(new Date(note.updatedAt)))}
      </p>
    </button>
  );
}

export function NotesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const rows = useLiveQuery(() => db.notes.toArray(), []);
  const notes = alive(rows ?? []);

  const allTags = Array.from(new Set(notes.flatMap((n) => n.tags))).sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );

  const q = query.trim().toLowerCase();
  const filtered = notes
    .filter((n) => !q || n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q))
    .filter((n) => !tagFilter || n.tags.includes(tagFilter))
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt),
    );

  return (
    <Screen title="Заметки">
      <div className="space-y-3">
        <div className="relative">
          <Search
            size={18}
            className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted"
          />
          <Input
            value={query}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            placeholder="Поиск по заметкам"
            className="pl-10"
          />
        </div>

        {allTags.length > 0 && (
          <ChipRow>
            {allTags.map((tag) => (
              <Chip
                key={tag}
                active={tagFilter === tag}
                onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              >
                #{tag}
              </Chip>
            ))}
          </ChipRow>
        )}

        {filtered.length === 0 ? (
          notes.length === 0 ? (
            <EmptyState
              icon={StickyNote}
              title="Пока нет заметок"
              hint="Нажмите + и создайте первую. Поддерживается Markdown."
            />
          ) : (
            <EmptyState
              icon={Search}
              title="Ничего не найдено"
              hint="Попробуйте изменить запрос или снять фильтр по тегу."
            />
          )
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onOpen={() => navigate(`/notes/${note.id}`)}
              />
            ))}
          </div>
        )}
      </div>
      <Fab onClick={() => navigate('/notes/new')} />
    </Screen>
  );
}
