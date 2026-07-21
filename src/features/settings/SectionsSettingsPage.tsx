import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { GripVertical, Lock, RotateCcw } from 'lucide-react';
import { db } from '../../db/db';
import { updateSettings } from '../../hooks/useSettings';
import { Screen } from '../../components/layout/Screen';
import {
  SECTIONS,
  SECTION_BY_ID,
  MAX_BOTTOM,
  DEFAULT_BOTTOM,
  ANCHOR_ID,
} from '../../lib/sections';
import { computeNavLayout } from '../../lib/navLayout';

type Zone = 'bottom' | 'more' | 'hidden';
interface Order {
  bottom: string[];
  more: string[];
  hidden: string[];
}
const ZONES: Zone[] = ['bottom', 'more', 'hidden'];
const LAYOUT_OPTS = { maxBottom: MAX_BOTTOM, defaultBottom: DEFAULT_BOTTOM, anchorId: ANCHOR_ID };

/** Экран «Настроить разделы»: пользователь перекладывает разделы между нижней
 *  панелью и «Ещё» удержанием за ручку и прячет ненужные тумблером. Раскладка
 *  автосохраняется в settings.navConfig (device-local). «Ещё» — жёсткий якорь
 *  панели, «Сегодня»/«Настройки» нельзя спрятать. */
export function SectionsSettingsPage() {
  const settingsRow = useLiveQuery(() => db.settings.get('app'), []);
  const [order, setOrder] = useState<Order | null>(null);
  const inited = useRef(false);

  // Инициализация из сохранённой раскладки — один раз, когда settings загрузились.
  useEffect(() => {
    if (inited.current || !settingsRow) return;
    inited.current = true;
    const l = computeNavLayout(SECTIONS, settingsRow.navConfig, LAYOUT_OPTS);
    setOrder({ bottom: l.bottom.filter((id) => id !== ANCHOR_ID), more: l.more, hidden: l.hidden });
  }, [settingsRow]);

  // Автосохранение при каждом изменении раскладки — панель и «Ещё» обновляются сразу.
  useEffect(() => {
    if (!order) return;
    void updateSettings({ navConfig: { bottom: order.bottom, hidden: order.hidden } });
  }, [order]);

  // --- перетаскивание ---
  const [dragId, setDragId] = useState<string | null>(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [drop, setDrop] = useState<{ zone: Zone; index: number } | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const dropRef = useRef<{ zone: Zone; index: number } | null>(null);

  const applyMove = (id: string, toZone: Zone, toIndex: number) => {
    setOrder((prev) => {
      if (!prev) return prev;
      const sec = SECTION_BY_ID.get(id);
      if (toZone === 'hidden' && sec?.nonHideable) return prev; // нельзя спрятать
      const next: Order = { bottom: [...prev.bottom], more: [...prev.more], hidden: [...prev.hidden] };
      const withoutDrag = next.bottom.filter((x) => x !== id);
      if (toZone === 'bottom' && withoutDrag.length >= MAX_BOTTOM) return prev; // панель заполнена
      for (const z of ZONES) {
        const i = next[z].indexOf(id);
        if (i !== -1) next[z].splice(i, 1);
      }
      const clamped = Math.max(0, Math.min(toIndex, next[toZone].length));
      next[toZone].splice(clamped, 0, id);
      return next;
    });
  };

  const startDrag = (id: string, e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.preventDefault();
    dragIdRef.current = id;
    dropRef.current = null;
    setPointer({ x: e.clientX, y: e.clientY });
    setDrag(id);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* указатель уже неактивен */
    }
  };
  const setDrag = (id: string | null) => {
    dragIdRef.current = id;
    setDragId(id);
  };

  useEffect(() => {
    if (!dragId) return;
    const hitTest = (y: number): { zone: Zone; index: number } | null => {
      for (const zone of ZONES) {
        const zoneEl = document.querySelector(`[data-zone="${zone}"]`);
        if (!zoneEl) continue;
        const r = zoneEl.getBoundingClientRect();
        if (y < r.top - 4 || y > r.bottom + 4) continue;
        const cards = [...zoneEl.querySelectorAll('[data-sid]')];
        let idx = 0;
        for (const c of cards) {
          if (c.getAttribute('data-sid') === dragId) continue; // себя не считаем
          const cr = c.getBoundingClientRect();
          if (y > cr.top + cr.height / 2) idx++;
        }
        return { zone, index: idx };
      }
      return null;
    };
    const move = (e: PointerEvent) => {
      e.preventDefault();
      setPointer({ x: e.clientX, y: e.clientY });
      const t = hitTest(e.clientY);
      dropRef.current = t;
      setDrop(t);
    };
    const finish = () => {
      const id = dragIdRef.current;
      const t = dropRef.current;
      if (id && t) applyMove(id, t.zone, t.index);
      dragIdRef.current = null;
      dropRef.current = null;
      setDragId(null);
      setDrop(null);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    const prevTouch = document.body.style.touchAction;
    document.body.style.touchAction = 'none';
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      document.body.style.touchAction = prevTouch;
    };
  }, [dragId]);

  const toggleHide = (id: string) => {
    setOrder((prev) => {
      if (!prev) return prev;
      if (SECTION_BY_ID.get(id)?.nonHideable) return prev;
      const next: Order = { bottom: [...prev.bottom], more: [...prev.more], hidden: [...prev.hidden] };
      const inHidden = next.hidden.indexOf(id);
      if (inHidden !== -1) {
        next.hidden.splice(inHidden, 1);
        next.more.push(id); // показать → в «Ещё»
      } else {
        for (const z of ['bottom', 'more'] as Zone[]) {
          const i = next[z].indexOf(id);
          if (i !== -1) next[z].splice(i, 1);
        }
        next.hidden.push(id);
      }
      return next;
    });
  };

  const reset = () => {
    const l = computeNavLayout(SECTIONS, undefined, LAYOUT_OPTS);
    setOrder({ bottom: l.bottom.filter((id) => id !== ANCHOR_ID), more: l.more, hidden: l.hidden });
  };

  const previewBottom = useMemo(() => {
    if (!order) return [];
    const l = computeNavLayout(SECTIONS, { bottom: order.bottom, hidden: order.hidden }, LAYOUT_OPTS);
    return l.bottom.map((id) => SECTION_BY_ID.get(id)).filter((s) => Boolean(s));
  }, [order]);

  if (!order) {
    return (
      <Screen title="Настроить разделы" backTo="/more/settings">
        <div className="py-10 text-center text-sm text-muted">Загрузка…</div>
      </Screen>
    );
  }

  const dropLine = (zone: Zone, index: number) =>
    drop && drop.zone === zone && drop.index === index ? (
      <div
        className="my-1 h-1 rounded-full bg-accent shadow-[0_0_10px_2px_var(--app-accent)]"
        aria-hidden
      />
    ) : null;

  const row = (id: string, zone: Zone) => {
    const sec = SECTION_BY_ID.get(id);
    if (!sec) return null;
    const Icon = sec.icon;
    const hidden = zone === 'hidden';
    const locked = Boolean(sec.nonHideable);
    return (
      <div
        key={id}
        data-sid={id}
        className={`flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 transition-opacity ${
          hidden ? 'opacity-45' : ''
        } ${dragId === id ? 'opacity-30' : ''}`}
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
          <Icon size={20} />
        </div>
        <span className="min-w-0 flex-1 truncate font-semibold">{sec.label}</span>
        {locked ? (
          <span className="flex items-center gap-1 rounded-full border border-hairline px-2 py-1 text-xs text-muted">
            <Lock size={12} /> всегда
          </span>
        ) : (
          <button
            type="button"
            onClick={() => toggleHide(id)}
            aria-label={hidden ? `Показать раздел ${sec.label}` : `Скрыть раздел ${sec.label}`}
            className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
              hidden ? 'border-border bg-surface-2' : 'border-transparent bg-accent'
            }`}
          >
            <span
              className={`absolute top-0.5 size-4 rounded-full bg-white shadow transition-all ${
                hidden ? 'left-0.5' : 'left-[22px]'
              }`}
            />
          </button>
        )}
        <button
          type="button"
          aria-label={`Перетащить раздел ${sec.label}`}
          onPointerDown={(e) => startDrag(id, e)}
          className="shrink-0 cursor-grab touch-none p-1 text-muted/50 active:text-accent"
        >
          <GripVertical size={20} />
        </button>
      </div>
    );
  };

  const anchor = SECTION_BY_ID.get(ANCHOR_ID);

  return (
    <Screen title="Настроить разделы" backTo="/more/settings">
      <p className="mb-4 px-1 text-sm leading-relaxed text-muted">
        Перетащите раздел за ручку, чтобы поменять порядок или перенести между «Нижней панелью» и
        «Ещё». Тумблер показывает или скрывает раздел.
      </p>

      {/* Нижняя панель */}
      <div className="mb-1.5 flex items-center gap-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
        Нижняя панель
        <span className="font-semibold normal-case tracking-normal opacity-80">
          · до {MAX_BOTTOM} + «Ещё»
        </span>
      </div>
      <div data-zone="bottom" className="mb-6 space-y-2">
        {order.bottom.map((id, i) => (
          <div key={id}>
            {dropLine('bottom', i)}
            {row(id, 'bottom')}
          </div>
        ))}
        {dropLine('bottom', order.bottom.length)}
        {/* якорь «Ещё» — всегда последний, без тумблера и ручки */}
        {anchor && (
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
              <anchor.icon size={20} />
            </div>
            <span className="min-w-0 flex-1 truncate font-semibold">{anchor.label}</span>
            <span className="flex items-center gap-1 rounded-full border border-hairline px-2 py-1 text-xs text-muted">
              <Lock size={12} /> всегда
            </span>
          </div>
        )}
      </div>

      {/* В Ещё */}
      <div className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-muted">
        В разделе «Ещё»
      </div>
      <div data-zone="more" className="mb-6 min-h-[8px] space-y-2">
        {order.more.map((id, i) => (
          <div key={id}>
            {dropLine('more', i)}
            {row(id, 'more')}
          </div>
        ))}
        {dropLine('more', order.more.length)}
      </div>

      {/* Скрытые */}
      {order.hidden.length > 0 && (
        <>
          <div className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-muted">
            Скрытые
          </div>
          <div data-zone="hidden" className="mb-6 space-y-2">
            {order.hidden.map((id, i) => (
              <div key={id}>
                {dropLine('hidden', i)}
                {row(id, 'hidden')}
              </div>
            ))}
            {dropLine('hidden', order.hidden.length)}
          </div>
        </>
      )}

      <button
        type="button"
        onClick={reset}
        className="mb-8 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-3.5 text-sm font-semibold text-muted active:opacity-70"
      >
        <RotateCcw size={16} /> Сбросить по умолчанию
      </button>

      {/* Превью панели */}
      <div className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
        Как будет выглядеть панель
      </div>
      <div className="flex overflow-hidden rounded-2xl border border-hairline bg-elevated">
        {previewBottom.map((s) =>
          s ? (
            <div key={s.id} className="flex flex-1 flex-col items-center gap-1 py-2.5">
              <s.icon size={20} className="text-muted" />
              <span className="text-[10px] font-semibold text-muted">{s.label}</span>
            </div>
          ) : null,
        )}
      </div>

      {dragId && (
        <div
          className="pointer-events-none fixed z-[70] max-w-[60vw] -translate-y-1/2 translate-x-3 truncate rounded-xl border border-accent bg-elevated px-3 py-2 text-sm font-semibold shadow-lg shadow-black/30"
          style={{ left: pointer.x, top: pointer.y }}
        >
          {SECTION_BY_ID.get(dragId)?.label}
        </div>
      )}
    </Screen>
  );
}
