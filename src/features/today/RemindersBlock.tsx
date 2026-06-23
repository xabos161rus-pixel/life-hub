import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ChevronDown, Plus, Pencil, Trash2 } from 'lucide-react';
import { db } from '../../db/db';
import { alive, create, update, remove } from '../../db/repo';
import type { ReminderItem, ReminderSection } from '../../db/types';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { Field, Input } from '../../components/ui/Input';

/** Закреплённые напоминания на «Сегодня»: разделы по темам (Работа и т.п.),
 *  каждый сворачивается/разворачивается по ситуации. */
export function RemindersBlock() {
  const sections = (alive(useLiveQuery(() => db.reminderSections.toArray(), []) ?? []) as ReminderSection[]).sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const items = alive(useLiveQuery(() => db.reminderItems.toArray(), []) ?? []) as ReminderItem[];

  const itemsBySection = useMemo(() => {
    const map = new Map<string, ReminderItem[]>();
    for (const it of items) {
      const arr = map.get(it.sectionId);
      if (arr) arr.push(it);
      else map.set(it.sectionId, [it]);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.sortOrder - b.sortOrder);
    return map;
  }, [items]);

  // null — закрыто, 'new' — создание, объект — редактирование.
  const [sectionSheet, setSectionSheet] = useState<ReminderSection | 'new' | null>(null);
  const [itemSheet, setItemSheet] = useState<{ sectionId: string; item: ReminderItem | null } | null>(null);

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted">Напоминания</h2>
        <button
          onClick={() => setSectionSheet('new')}
          className="inline-flex items-center gap-1 text-sm font-medium text-accent active:opacity-70"
        >
          <Plus size={16} /> раздел
        </button>
      </div>

      {sections.length === 0 ? (
        <button
          onClick={() => setSectionSheet('new')}
          className="card w-full px-4 py-3 text-left text-sm text-muted active:opacity-80"
        >
          Добавьте раздел — например, «Работа» — и держите под рукой важные напоминания.
        </button>
      ) : (
        <div className="flex flex-col gap-3">
          {sections.map((s) => (
            <ReminderSectionCard
              key={s.id}
              section={s}
              items={itemsBySection.get(s.id) ?? []}
              onToggle={() => void update(db.reminderSections, s.id, { collapsed: !s.collapsed })}
              onEditSection={() => setSectionSheet(s)}
              onAddItem={() => setItemSheet({ sectionId: s.id, item: null })}
              onEditItem={(it) => setItemSheet({ sectionId: s.id, item: it })}
            />
          ))}
        </div>
      )}

      <SectionSheet
        key={sectionSheet === 'new' ? 'sec-new' : sectionSheet ? `sec-${sectionSheet.id}` : 'sec-closed'}
        open={sectionSheet !== null}
        section={sectionSheet === 'new' ? null : sectionSheet}
        onClose={() => setSectionSheet(null)}
      />
      {itemSheet && (
        <ItemSheet
          key={itemSheet.item ? `it-${itemSheet.item.id}` : `it-new-${itemSheet.sectionId}`}
          sectionId={itemSheet.sectionId}
          item={itemSheet.item}
          onClose={() => setItemSheet(null)}
        />
      )}
    </section>
  );
}

function ReminderSectionCard({
  section,
  items,
  onToggle,
  onEditSection,
  onAddItem,
  onEditItem,
}: {
  section: ReminderSection;
  items: ReminderItem[];
  onToggle: () => void;
  onEditSection: () => void;
  onAddItem: () => void;
  onEditItem: (it: ReminderItem) => void;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center">
        <button onClick={onToggle} className="flex flex-1 items-center gap-2 px-4 py-3 text-left active:opacity-80">
          <ChevronDown
            size={18}
            className={`shrink-0 text-muted transition-transform ${section.collapsed ? '-rotate-90' : ''}`}
          />
          <span className="min-w-0 flex-1 truncate font-semibold">{section.title}</span>
          <span className="shrink-0 text-xs text-muted">{items.length}</span>
        </button>
        <button onClick={onEditSection} aria-label="Изменить раздел" className="px-3.5 py-3 text-muted active:opacity-60">
          <Pencil size={15} />
        </button>
      </div>

      {!section.collapsed && (
        <div className="space-y-2 px-3 pb-3 pt-0.5">
          {items.map((it) => (
            <button
              key={it.id}
              onClick={() => onEditItem(it)}
              className="block w-full rounded-xl border-l-[3px] border-accent bg-surface-2 px-3.5 py-2.5 text-left active:opacity-80"
            >
              <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-text">{it.text}</p>
            </button>
          ))}
          <button
            onClick={onAddItem}
            className="inline-flex items-center gap-1.5 px-1 pt-0.5 text-sm font-medium text-accent active:opacity-70"
          >
            <Plus size={16} /> напоминание
          </button>
        </div>
      )}
    </div>
  );
}

function SectionSheet({
  open,
  section,
  onClose,
}: {
  open: boolean;
  section: ReminderSection | null;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(section?.title ?? '');

  async function save() {
    const t = title.trim();
    if (!t) return;
    if (section) await update(db.reminderSections, section.id, { title: t });
    else await create(db.reminderSections, { title: t, collapsed: false, sortOrder: Date.now() });
    onClose();
  }

  async function del() {
    if (!section) return;
    if (!window.confirm('Удалить раздел вместе с его напоминаниями?')) return;
    const its = await db.reminderItems.where('sectionId').equals(section.id).toArray();
    for (const it of its) await remove(db.reminderItems, it.id);
    await remove(db.reminderSections, section.id);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title={section ? 'Раздел напоминаний' : 'Новый раздел'}>
      <div className="space-y-4 pb-2">
        <Field label="Название раздела">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Например, «Работа»" autoFocus />
        </Field>
        <div className="flex gap-2">
          {section && (
            <Button variant="danger" onClick={() => void del()} className="inline-flex items-center gap-1.5">
              <Trash2 size={16} /> Удалить
            </Button>
          )}
          <Button className="flex-1" disabled={!title.trim()} onClick={() => void save()}>
            Сохранить
          </Button>
        </div>
      </div>
    </Sheet>
  );
}

function ItemSheet({
  sectionId,
  item,
  onClose,
}: {
  sectionId: string;
  item: ReminderItem | null;
  onClose: () => void;
}) {
  const [text, setText] = useState(item?.text ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);

  // Авто-рост поля под текст (напоминание может быть длинным/многострочным).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  async function save() {
    const t = text.trim();
    if (!t) return;
    if (item) await update(db.reminderItems, item.id, { text: t });
    else await create(db.reminderItems, { sectionId, text: t, sortOrder: Date.now() });
    onClose();
  }

  async function del() {
    if (!item) return;
    await remove(db.reminderItems, item.id);
    onClose();
  }

  return (
    <Sheet open onClose={onClose} title={item ? 'Напоминание' : 'Новое напоминание'}>
      <div className="space-y-4 pb-2">
        <Field label="Текст напоминания">
          <textarea
            ref={ref}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Например: максимальные расходы на работе 465 ₽"
            className="w-full resize-none overflow-hidden whitespace-pre-wrap rounded-xl border border-hairline bg-surface-2 px-3.5 py-3 text-text placeholder:text-muted outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-2 focus:ring-accent/25"
            autoFocus
          />
        </Field>
        <div className="flex gap-2">
          {item && (
            <Button variant="danger" onClick={() => void del()} className="inline-flex items-center gap-1.5">
              <Trash2 size={16} /> Удалить
            </Button>
          )}
          <Button className="flex-1" disabled={!text.trim()} onClick={() => void save()}>
            Сохранить
          </Button>
        </div>
      </div>
    </Sheet>
  );
}
