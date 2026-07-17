import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, CheckCheck, ChevronsDown, Clock, Copy, Hand, Heart, Send, Pencil, Reply, Trash2, X, Paperclip, Mic, Play, Pause } from 'lucide-react';
import { db } from '../../db/db';
import type { FamilyMessage } from '../../db/types';
import { Sheet } from '../../components/ui/Sheet';
import { Hint } from '../../components/ui/Hint';
import { useToast } from '../../components/ui/Toast';
import { compressImage } from '../../lib/image';
import { getFamilyConfig } from '../../lib/family/familyState';
import {
  sendMessage,
  sendImage,
  sendAudio,
  sendReaction,
  sendTyping,
  subscribeTyping,
  editMessage,
  deleteMessage,
  subscribeReads,
  subscribePresence,
  subscribeLastSeen,
  markSeen,
} from '../../lib/family/familyChat';
import { useVoiceRecorder } from './useVoiceRecorder';

// Палитра быстрых реакций — как в WhatsApp/Telegram, шесть базовых.
const REACTIONS = ['❤️', '👍', '😂', '😮', '😢', '🔥'];

/** мм:сс из секунд. */
function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Плеер голосового: play/pause + полоса прогресса + длительность. */
function AudioBubble({ src, duration, own }: { src: string; duration: number; own: boolean }) {
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const aRef = useRef<HTMLAudioElement>(null);
  const total = duration || pos || 1;
  return (
    <div className="flex min-w-[170px] items-center gap-2.5 py-0.5">
      <button
        onClick={(e) => {
          e.stopPropagation();
          const a = aRef.current;
          if (!a) return;
          if (a.paused) void a.play();
          else a.pause();
        }}
        aria-label={playing ? 'Пауза' : 'Воспроизвести'}
        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${own ? 'bg-white/20 text-white' : 'bg-accent/15 text-accent'}`}
      >
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className={`h-1 flex-1 overflow-hidden rounded-full ${own ? 'bg-white/25' : 'bg-hairline'}`}>
        <div className="h-full rounded-full bg-current" style={{ width: `${Math.min(100, (pos / total) * 100)}%` }} />
      </div>
      <span className="shrink-0 text-[11px] tabular-nums">{fmtDur(playing || pos ? pos : duration)}</span>
      <audio
        ref={aRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setPos(0);
        }}
        onTimeUpdate={(e) => setPos((e.target as HTMLAudioElement).currentTime)}
      />
    </div>
  );
}

// Единый порядок сообщений: подтверждённые по seq, неотправленные — в конец
// по времени. Реакции — служебные записи, в ленте не показываются.
function msgOrder(a: FamilyMessage, b: FamilyMessage): number {
  if (a.seq != null && b.seq != null) return a.seq - b.seq;
  if (a.seq == null && b.seq == null) return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  return a.seq == null ? 1 : -1;
}
function ordered(msgs: FamilyMessage[]): FamilyMessage[] {
  return [...msgs].filter((m) => !m.deletedAt && !m.reaction).sort(msgOrder);
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

/** «Сегодня» / «Вчера» / «5 июля» — разделители дней в ленте. */
function dayLabel(iso: string, now: number): string {
  const d = new Date(iso);
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Вчера';
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === today.getFullYear() ? { day: 'numeric', month: 'long' } : { day: 'numeric', month: 'long', year: 'numeric' };
  return d.toLocaleDateString('ru-RU', opts);
}
function dayKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** «5 мин назад» / «2 ч назад» / «вчера» / «3 июн». now передаётся state'ом,
 *  чтобы не звать Date.now() в теле рендера (react-hooks/purity). */
function relTime(iso: string, now: number): string {
  const min = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} ч назад`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'вчера';
  if (d < 7) return `${d} дн назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** Сниппет сообщения для цитаты ответа. */
function snippetOf(m: FamilyMessage): string {
  if (m.text) return m.text.slice(0, 120);
  if (m.image) return 'Фото';
  if (m.audio) return 'Голосовое сообщение';
  return 'Сообщение';
}

const SWIPE_REPLY_PX = 56; // порог свайпа вправо «ответить»
const LONG_PRESS_MS = 450;
const DOUBLE_TAP_MS = 300;

/** Пузырь сообщения с жестами «как у всех»:
 *  свайп вправо — ответить · долгое нажатие — меню · двойной тап — ❤️ ·
 *  тап по фото — просмотр · обычный тап — меню (открываемость для новичков).
 *  Вложенные кнопки (цитата, play) жестам не мешают — фильтруются по closest.
 */
function MessageRow({
  m,
  own,
  authorName,
  authorColor,
  highlight,
  chips,
  maxOtherRead,
  onMenu,
  onReply,
  onHeart,
  onOpenImage,
  onJumpTo,
  onToggleChip,
}: {
  m: FamilyMessage;
  own: boolean;
  authorName: string | null;
  authorColor: string | null;
  highlight: boolean;
  chips: { emoji: string; count: number; mine: boolean }[] | undefined;
  maxOtherRead: number;
  onMenu: (m: FamilyMessage) => void;
  onReply: (m: FamilyMessage) => void;
  onHeart: (m: FamilyMessage) => void;
  onOpenImage: (src: string) => void;
  onJumpTo: (id: string) => void;
  onToggleChip: (m: FamilyMessage, emoji: string) => void;
}) {
  const [dragX, setDragX] = useState(0);
  const g = useRef({
    x0: 0,
    y0: 0,
    // Текущий сдвиг дублируется в ref: при быстром свайпе pointerup приходит
    // до ре-рендера, и state в замыкании обработчика ещё старый.
    dx: 0,
    mode: 'idle' as 'idle' | 'swipe' | 'longpress' | 'skip',
    lastTapAt: 0,
    onImage: false,
    lpTimer: null as ReturnType<typeof setTimeout> | null,
    tapTimer: null as ReturnType<typeof setTimeout> | null,
  });

  const clearLp = () => {
    if (g.current.lpTimer) {
      clearTimeout(g.current.lpTimer);
      g.current.lpTimer = null;
    }
  };

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Тапы по интерактивам внутри пузыря (цитата, play) — не наши жесты.
    if ((e.target as Element).closest('button, audio')) {
      g.current.mode = 'skip';
      return;
    }
    g.current.mode = 'idle';
    g.current.x0 = e.clientX;
    g.current.y0 = e.clientY;
    g.current.onImage = Boolean((e.target as Element).closest('img'));
    clearLp();
    const msg = m;
    g.current.lpTimer = setTimeout(() => {
      g.current.mode = 'longpress';
      try {
        navigator.vibrate?.(10);
      } catch {
        /* iOS игнорирует */
      }
      onMenu(msg);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const s = g.current;
    if (s.mode === 'skip' || s.mode === 'longpress') return;
    const dx = e.clientX - s.x0;
    const dy = e.clientY - s.y0;
    if (s.mode === 'idle' && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      clearLp(); // палец пошёл — это не long-press
      if (dx > 0 && Math.abs(dx) > Math.abs(dy)) {
        s.mode = 'swipe';
        e.currentTarget.setPointerCapture(e.pointerId);
      } else {
        s.mode = 'skip'; // вертикаль — отдаём скроллу ленты
      }
    }
    if (s.mode === 'swipe') {
      s.dx = Math.max(0, Math.min(SWIPE_REPLY_PX + 24, dx));
      setDragX(s.dx);
    }
  }

  function onPointerUp() {
    const s = g.current;
    clearLp();
    if (s.mode === 'swipe') {
      if (s.dx >= SWIPE_REPLY_PX) onReply(m);
      s.dx = 0;
      setDragX(0);
      s.mode = 'idle';
      return;
    }
    if (s.mode === 'longpress' || s.mode === 'skip') {
      s.mode = 'idle';
      return;
    }
    // Тап: различаем одиночный и двойной.
    const nowTs = Date.now();
    if (nowTs - s.lastTapAt < DOUBLE_TAP_MS) {
      s.lastTapAt = 0;
      if (s.tapTimer) {
        clearTimeout(s.tapTimer);
        s.tapTimer = null;
      }
      onHeart(m); // двойной тап — быстрое ❤️
      return;
    }
    s.lastTapAt = nowTs;
    const openImage = s.onImage && m.image;
    const msg = m;
    s.tapTimer = setTimeout(() => {
      s.tapTimer = null;
      if (openImage) onOpenImage(msg.image!);
      else onMenu(msg);
    }, DOUBLE_TAP_MS);
  }

  function onPointerCancel() {
    clearLp();
    g.current.mode = 'idle';
    g.current.dx = 0;
    setDragX(0);
  }

  return (
    <div className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[80%] flex-col ${own ? 'items-end' : 'items-start'}`}>
        <div className="flex items-center">
          {dragX > 4 && (
            <span
              className="flex shrink-0 items-center pr-2 text-accent"
              style={{ opacity: Math.min(1, dragX / SWIPE_REPLY_PX) }}
            >
              <Reply size={18} />
            </span>
          )}
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              touchAction: 'pan-y',
              transform: dragX ? `translateX(${dragX}px)` : undefined,
              transition: dragX ? undefined : 'transform 160ms ease',
              WebkitTouchCallout: 'none',
            }}
            className={`cursor-pointer select-none overflow-hidden rounded-2xl transition-shadow active:opacity-80 ${
              m.image ? 'p-1' : 'px-3 py-2'
            } ${own ? 'bg-accent text-white' : 'bg-surface-2 text-text'} ${
              highlight ? 'ring-2 ring-frost' : ''
            }`}
          >
            {!own && authorName && (
              <p className={`mb-0.5 text-xs font-semibold ${m.image ? 'px-2 pt-1' : ''}`} style={{ color: authorColor ?? undefined }}>
                {authorName}
              </p>
            )}
            {m.replyTo && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onJumpTo(m.replyTo!.id);
                }}
                className={`mb-1 block w-full rounded-lg border-l-2 px-2 py-1 text-left ${
                  m.image ? 'mx-2 mt-1 w-auto' : ''
                } ${own ? 'border-white/60 bg-white/15' : 'border-accent bg-accent/10'}`}
              >
                <span className={`block text-[11px] font-semibold ${own ? 'text-white/90' : 'text-accent'}`}>
                  {m.replyTo.name}
                </span>
                <span className={`block truncate text-xs ${own ? 'text-white/75' : 'text-muted'}`}>
                  {m.replyTo.text}
                </span>
              </button>
            )}
            {m.audio && <AudioBubble src={m.audio} duration={m.audioDur ?? 0} own={own} />}
            {m.image && (
              <img src={m.image} alt="Фото" loading="lazy" className="block max-h-80 max-w-full rounded-xl" draggable={false} />
            )}
            {m.text && (
              <p className={`whitespace-pre-wrap break-words text-[15px] ${m.image ? 'px-2 pt-1' : ''}`}>{m.text}</p>
            )}
            <span className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${m.image ? 'px-2 pb-1' : ''} ${own ? 'text-white/70' : 'text-muted'}`}>
              {m.editedAt && <span>изменено</span>}
              {timeLabel(m.createdAt)}
              {own &&
                (m.status === 'pending' ? (
                  <Clock size={11} />
                ) : m.seq != null && maxOtherRead >= m.seq ? (
                  <CheckCheck size={13} className="text-sky-300" />
                ) : (
                  <Check size={11} />
                ))}
            </span>
          </div>
        </div>
        {chips && (
          <div className={`mt-1 flex flex-wrap gap-1 ${own ? 'justify-end' : ''}`}>
            {chips.map((c) => (
              <button
                key={c.emoji}
                type="button"
                onClick={() => onToggleChip(m, c.emoji)}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs active:scale-95 ${
                  c.mine ? 'border-accent/50 bg-accent/15' : 'border-border bg-surface-2'
                }`}
              >
                <span>{c.emoji}</span>
                {c.count > 1 && <span className="tabular-nums text-muted">{c.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ChatTab({ familyId }: { familyId: string }) {
  const toast = useToast();
  const messagesRaw = useLiveQuery(() => db.familyMessages.where('familyId').equals(familyId).toArray(), [familyId]);
  const membersRaw = useLiveQuery(() => db.familyMembers.where('familyId').equals(familyId).toArray(), [familyId]);
  const config = useLiveQuery(() => getFamilyConfig(familyId), [familyId]);
  const selfId = config?.selfMemberId;

  const memberMap = useMemo(() => Object.fromEntries((membersRaw ?? []).map((m) => [m.id, m])), [membersRaw]);
  const list = useMemo(() => ordered(messagesRaw ?? []), [messagesRaw]);

  // Реакции: append-only записи; последняя реакция участника на target
  // побеждает (порядок как в ленте: seq, потом pending по времени).
  const { reactionChips, myReactions } = useMemo(() => {
    const raws = (messagesRaw ?? []).filter((m) => m.reaction && !m.deletedAt).sort(msgOrder);
    const perSender = new Map<string, Map<string, string>>(); // target → sender → emoji
    for (const r of raws) {
      const { targetId, emoji } = r.reaction!;
      let m = perSender.get(targetId);
      if (!m) {
        m = new Map();
        perSender.set(targetId, m);
      }
      m.set(r.senderMemberId, emoji);
    }
    const chips = new Map<string, { emoji: string; count: number; mine: boolean }[]>();
    const mine = new Map<string, string>();
    for (const [target, senders] of perSender) {
      const agg = new Map<string, { count: number; mine: boolean }>();
      for (const [sender, emoji] of senders) {
        if (sender === selfId && emoji) mine.set(target, emoji);
        if (!emoji) continue;
        const a = agg.get(emoji) ?? { count: 0, mine: false };
        a.count += 1;
        if (sender === selfId) a.mine = true;
        agg.set(emoji, a);
      }
      if (agg.size) chips.set(target, [...agg.entries()].map(([emoji, a]) => ({ emoji, ...a })));
    }
    return { reactionChips: chips, myReactions: mine };
  }, [messagesRaw, selfId]);

  // Presence в шапке чата: онлайн-статус собеседника(ов) + «был(а) в сети …».
  const others = useMemo(
    () => (membersRaw ?? []).filter((m) => !m.leftAt && m.id !== selfId),
    [membersRaw, selfId],
  );
  const [online, setOnline] = useState<string[]>([]);
  const [lastSeen, setLastSeen] = useState<Record<string, string>>({});
  const [now, setNow] = useState(0);
  useEffect(() => subscribePresence(familyId, setOnline), [familyId]);
  useEffect(() => subscribeLastSeen(familyId, setLastSeen), [familyId]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const raf = requestAnimationFrame(tick); // первый расчёт сразу, вне тела эффекта (purity)
    const id = setInterval(tick, 60_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, []);
  const onlineSet = useMemo(() => new Set(online), [online]);

  // «Печатает…»: memberId → момент, когда индикатор погаснет.
  const [typingUntil, setTypingUntil] = useState<Record<string, number>>({});
  useEffect(
    () =>
      subscribeTyping(familyId, (memberId) => {
        setTypingUntil((prev) => ({ ...prev, [memberId]: Date.now() + 4000 }));
      }),
    [familyId],
  );
  useEffect(() => {
    if (Object.keys(typingUntil).length === 0) return;
    const id = setInterval(() => {
      setTypingUntil((prev) => {
        const t = Date.now();
        const next = Object.fromEntries(Object.entries(prev).filter(([, until]) => until > t));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [typingUntil]);
  const typers = useMemo(
    () => Object.keys(typingUntil).filter((id) => id !== selfId && memberMap[id] && !memberMap[id].leftAt),
    [typingUntil, selfId, memberMap],
  );

  const [text, setText] = useState('');
  const [actionMsg, setActionMsg] = useState<FamilyMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<FamilyMessage | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [viewImage, setViewImage] = useState<string | null>(null);
  const [reads, setReadsState] = useState<Record<string, number>>({});
  useEffect(() => subscribeReads(familyId, setReadsState), [familyId]);
  // Максимальный seq, прочитанный ХОТЬ кем-то из других участников.
  const maxOtherRead = useMemo(
    () => Object.entries(reads).reduce((mx, [id, s]) => (id !== selfId ? Math.max(mx, s) : mx), 0),
    [reads, selfId],
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Отмечаем прочитанным до последнего seq, когда чат открыт и виден.
  useEffect(() => {
    if (document.visibilityState !== 'visible') return;
    const maxSeq = list.reduce((mx, m) => Math.max(mx, m.seq ?? 0), 0);
    markSeen(familyId, maxSeq);
  }, [list, familyId]);

  // Автоскролл. ВАЖНО: двигаем ТОЛЬКО свой scrollRef (el.scrollTop), а не
  // scrollIntoView — тот прокручивает ВСЕХ предков, что в паре вложенных
  // overflow-контейнеров устраивало «войну скроллов» (заморозка на iOS).
  const didInitialScroll = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || list.length === 0) return;
    // Первый показ ленты: сразу к последнему сообщению (а не к первому).
    if (!didInitialScroll.current) {
      didInitialScroll.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    // Дальше — доскролл к низу при новом сообщении, только если уже у низа.
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
    }
  }, [list.length]);

  // Прыжок к сообщению (тап по цитате): свой scrollTop + подсветка на секунду.
  function jumpToMessage(id: string) {
    const scrollEl = scrollRef.current;
    const node = scrollEl?.querySelector<HTMLElement>(`[data-msg-id="${id}"]`);
    if (!scrollEl || !node) return;
    const nr = node.getBoundingClientRect();
    const sr = scrollEl.getBoundingClientRect();
    scrollEl.scrollTop += nr.top - sr.top - 72;
    setHighlightId(id);
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 1300);
  }

  async function submit() {
    const body = text.trim();
    if (!body) return;
    setText('');
    if (editingId) {
      const id = editingId;
      setEditingId(null);
      await editMessage(familyId, id, body);
    } else {
      const quote = replyTo
        ? {
            id: replyTo.clientMsgId,
            name: memberMap[replyTo.senderMemberId]?.displayName || 'Участник',
            text: snippetOf(replyTo),
          }
        : undefined;
      setReplyTo(null);
      await sendMessage(familyId, body, quote);
    }
  }

  function startEdit(m: FamilyMessage) {
    setEditingId(m.clientMsgId);
    setReplyTo(null);
    setText(m.text);
    setActionMsg(null);
  }

  function startReply(m: FamilyMessage) {
    setReplyTo(m);
    setEditingId(null);
    setActionMsg(null);
  }

  async function copyText(m: FamilyMessage) {
    setActionMsg(null);
    try {
      await navigator.clipboard.writeText(m.text);
      toast('Скопировано');
    } catch {
      toast('Не удалось скопировать');
    }
  }

  async function toggleReaction(m: FamilyMessage, emoji: string) {
    setActionMsg(null);
    const current = myReactions.get(m.clientMsgId);
    await sendReaction(familyId, m.clientMsgId, current === emoji ? '' : emoji);
  }

  async function doDelete(m: FamilyMessage) {
    setActionMsg(null);
    if (editingId === m.clientMsgId) {
      setEditingId(null);
      setText('');
    }
    await deleteMessage(familyId, m.clientMsgId);
  }

  async function handlePickImage(file: File) {
    try {
      const dataUrl = await compressImage(file);
      await sendImage(familyId, dataUrl);
    } catch {
      /* не удалось обработать картинку */
    }
  }

  const rec = useVoiceRecorder((dataUrl, dur) => {
    void sendAudio(familyId, dataUrl, dur);
  });

  const headerStatus = (() => {
    if (others.length === 0) return null;
    if (typers.length > 0) {
      const name = memberMap[typers[0]]?.displayName;
      return others.length === 1 ? 'печатает…' : `${name || 'Кто-то'} печатает…`;
    }
    if (others.length === 1) {
      return onlineSet.has(others[0].id)
        ? 'в сети'
        : lastSeen[others[0].id] && now
          ? `был(а) в сети ${relTime(lastSeen[others[0].id], now)}`
          : 'не в сети';
    }
    return `${others.filter((o) => onlineSet.has(o.id)).length} в сети`;
  })();

  return (
    // Полная высота под чат от каркаса (Screen fill): лента растёт и скроллится,
    // композер прибит к низу. Без magic-number — высоту даёт родитель.
    <div className="flex h-full min-h-0 flex-col">
      {others.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5 px-1 pb-1.5 text-xs">
          {others.length === 1 ? (
            <>
              <span
                className={`size-2 shrink-0 rounded-full ${onlineSet.has(others[0].id) ? 'bg-success' : 'bg-muted'}`}
              />
              <span className="font-medium" style={{ color: others[0].color }}>
                {others[0].displayName}
              </span>
              <span className={typers.length > 0 ? 'text-accent' : 'text-muted'}>{headerStatus}</span>
            </>
          ) : (
            <>
              <span
                className={`size-2 shrink-0 rounded-full ${
                  others.some((o) => onlineSet.has(o.id)) ? 'bg-success' : 'bg-muted'
                }`}
              />
              <span className={typers.length > 0 ? 'text-accent' : 'text-muted'}>{headerStatus}</span>
            </>
          )}
        </div>
      )}
      <Hint
        id="chat-gestures"
        title="Жесты чата"
        className="mb-2 shrink-0"
        items={[
          { icon: Reply, text: <>Свайп по сообщению вправо — ответить</> },
          { icon: Heart, text: <>Двойной тап — быстрое ❤️</> },
          { icon: Hand, text: <>Тап или удержание — меню: реакции, копировать, править</> },
        ]}
      />
      {/* overscroll-contain: флик до края ленты НЕ чейнится в App-контейнер —
          без этого на iOS-momentum «война скроллов» с предком насыщала
          main-thread и чат замирал после прокруток вверх-вниз. */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            setShowJump(el.scrollHeight - el.scrollTop - el.clientHeight > 320);
          }}
          className="h-full overflow-y-auto overscroll-contain px-1"
        >
          {list.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted">Пока нет сообщений. Напишите первым!</p>
          ) : (
            <div className="space-y-2 py-2">
              {list.map((m, i) => {
                const divider =
                  i === 0 || dayKey(list[i - 1].createdAt) !== dayKey(m.createdAt) ? (
                    <div key={`d-${m.clientMsgId}`} className="flex items-center justify-center py-1.5">
                      <span className="rounded-full bg-surface-2/80 px-3 py-0.5 text-[11px] font-medium text-muted">
                        {now ? dayLabel(m.createdAt, now) : ''}
                      </span>
                    </div>
                  ) : null;
                if (m.system) {
                  return (
                    <div key={m.clientMsgId}>
                      {divider}
                      <div className="py-1 text-center">
                        <span className="inline-block rounded-full bg-surface-2 px-3 py-1 text-xs text-muted">{m.text}</span>
                      </div>
                    </div>
                  );
                }
                const own = m.senderMemberId === selfId;
                const author = memberMap[m.senderMemberId];
                const chips = reactionChips.get(m.clientMsgId);
                return (
                  <div key={m.clientMsgId}>
                    {divider}
                    <div data-msg-id={m.clientMsgId}>
                      <MessageRow
                        m={m}
                        own={own}
                        authorName={author?.displayName ?? null}
                        authorColor={author?.color ?? null}
                        highlight={highlightId === m.clientMsgId}
                        chips={chips}
                        maxOtherRead={maxOtherRead}
                        onMenu={setActionMsg}
                        onReply={startReply}
                        onHeart={(msg) => void toggleReaction(msg, '❤️')}
                        onOpenImage={setViewImage}
                        onJumpTo={jumpToMessage}
                        onToggleChip={(msg, emoji) => void toggleReaction(msg, emoji)}
                      />
                    </div>
                  </div>
                );
              })}
              <div ref={bottomRef} />
            </div>
          )}
        </div>
        {showJump && (
          <button
            type="button"
            aria-label="К последним сообщениям"
            onClick={() => {
              const el = scrollRef.current;
              if (el) el.scrollTop = el.scrollHeight;
            }}
            className="absolute bottom-3 right-2 flex size-10 items-center justify-center rounded-full border border-border bg-elevated/95 text-muted shadow-lg shadow-black/20 active:scale-95"
          >
            <ChevronsDown size={20} />
          </button>
        )}
      </div>

      <div className="shrink-0 border-t border-hairline bg-bg">
        {editingId && (
          <div className="flex items-center gap-2 px-1 pt-2 text-sm text-muted">
            <Pencil size={14} className="shrink-0 text-accent" />
            <span className="flex-1">Редактирование сообщения</span>
            <button
              onClick={() => {
                setEditingId(null);
                setText('');
              }}
              aria-label="Отменить редактирование"
              className="p-1 active:opacity-60"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {replyTo && (
          <div className="flex items-center gap-2 px-1 pt-2 text-sm">
            <Reply size={15} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1 border-l-2 border-accent pl-2">
              <p className="text-xs font-semibold text-accent">
                {memberMap[replyTo.senderMemberId]?.displayName || 'Участник'}
              </p>
              <p className="truncate text-xs text-muted">{snippetOf(replyTo)}</p>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              aria-label="Отменить ответ"
              className="p-1 text-muted active:opacity-60"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {rec.recording ? (
          <div className="flex items-center gap-3 px-2 py-2">
            <button
              onClick={rec.cancel}
              aria-label="Отменить запись"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger active:scale-95"
            >
              <Trash2 size={20} />
            </button>
            <div className="flex flex-1 items-center gap-2 text-sm">
              <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-danger" />
              <span className="font-mono tabular-nums">{fmtDur(rec.elapsed)}</span>
              <span className="text-muted">запись…</span>
            </div>
            <button
              onClick={rec.stop}
              aria-label="Отправить голосовое"
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-white active:scale-95"
            >
              <Send size={20} />
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-1.5 px-2 py-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void handlePickImage(f);
              }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              aria-label="Прикрепить фото"
              className="flex size-11 shrink-0 select-none items-center justify-center self-end rounded-full text-muted transition-colors active:bg-surface active:text-accent"
            >
              <Paperclip size={21} />
            </button>
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                if (e.target.value.trim()) sendTyping(familyId);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={1}
              placeholder="Сообщение…"
              className="max-h-28 min-h-[44px] min-w-0 flex-1 resize-none rounded-3xl border border-border bg-surface px-4 py-2.5 text-[15px] leading-tight outline-none focus:border-accent"
            />
            {text.trim() || !rec.supported ? (
              <button
                onClick={() => void submit()}
                disabled={!text.trim()}
                aria-label="Отправить"
                className="flex size-11 shrink-0 select-none items-center justify-center self-end rounded-full bg-gradient-to-br from-accent to-accent-2 text-white disabled:opacity-40 active:scale-95"
              >
                <Send size={20} />
              </button>
            ) : (
              <button
                onClick={() => void rec.start()}
                aria-label="Записать голосовое"
                className="flex size-11 shrink-0 select-none items-center justify-center self-end rounded-full bg-gradient-to-br from-accent to-accent-2 text-white active:scale-95"
              >
                <Mic size={20} />
              </button>
            )}
          </div>
        )}
      </div>

      <Sheet open={actionMsg !== null} onClose={() => setActionMsg(null)} title="Сообщение">
        {actionMsg && (
          <div className="space-y-2 pb-2">
            {!actionMsg.system && (
              <div className="flex justify-between gap-1 rounded-2xl bg-surface-2 p-2">
                {REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    onClick={() => void toggleReaction(actionMsg, emoji)}
                    aria-label={`Реакция ${emoji}`}
                    className={`flex size-10 items-center justify-center rounded-full text-[22px] transition-transform active:scale-90 ${
                      myReactions.get(actionMsg.clientMsgId) === emoji ? 'bg-accent/20 ring-1 ring-accent/50' : ''
                    }`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            <button
              onClick={() => startReply(actionMsg)}
              className="flex w-full items-center gap-3 rounded-xl bg-surface-2 p-3.5 text-left active:opacity-80"
            >
              <Reply size={18} className="text-accent" />
              Ответить
            </button>
            {actionMsg.text && (
              <button
                onClick={() => void copyText(actionMsg)}
                className="flex w-full items-center gap-3 rounded-xl bg-surface-2 p-3.5 text-left active:opacity-80"
              >
                <Copy size={18} className="text-accent" />
                Копировать
              </button>
            )}
            {actionMsg.senderMemberId === selfId && !actionMsg.image && !actionMsg.audio && (
              <button
                onClick={() => startEdit(actionMsg)}
                className="flex w-full items-center gap-3 rounded-xl bg-surface-2 p-3.5 text-left active:opacity-80"
              >
                <Pencil size={18} className="text-accent" />
                Редактировать
              </button>
            )}
            {actionMsg.senderMemberId === selfId && (
              <button
                onClick={() => void doDelete(actionMsg)}
                className="flex w-full items-center gap-3 rounded-xl bg-danger/15 p-3.5 text-left text-danger active:opacity-80"
              >
                <Trash2 size={18} />
                Удалить
              </button>
            )}
          </div>
        )}
      </Sheet>

      {/* Фото на весь экран (тап по фото в ленте) — закрытие тапом. */}
      {viewImage && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/95 p-3"
          onClick={() => setViewImage(null)}
        >
          <img src={viewImage} alt="" className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
      )}
    </div>
  );
}
