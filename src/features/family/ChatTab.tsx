import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useLoaded } from '../../hooks/useLoaded';
import {
  ArrowRight,
  CheckCheck,
  ChevronsDown,
  Clock,
  Copy,
  Hand,
  Heart,
  Send,
  Reply,
  Paperclip,
  Mic,
  Play,
  Pause,
  Loader2,
  Image as ImageIcon,
  File as FileIcon,
  FileText,
  FileArchive,
  FileSpreadsheet,
} from 'lucide-react';
import {
  GCheck as Check,
  GPencil as Pencil,
  GTrash as Trash2,
  GClose as X,
} from '../../components/ui/glyphs';
import { db } from '../../db/db';
import type { FamilyMessage } from '../../db/types';
import { Sheet } from '../../components/ui/Sheet';
import { Hint } from '../../components/ui/Hint';
import { useToast } from '../../components/ui/toastContext';
import {
  compressImage,
  ImageDecodeError,
  ImageTooLargeError,
  MAX_INPUT_BYTES,
} from '../../lib/image';
import { fileKindLabel, formatFileSize, MAX_FILE_BYTES } from '../../lib/family/fileTransfer';
import { isTouch } from '../../lib/platform';
import { getFamilyConfig } from '../../lib/family/familyState';
import {
  sendMessage,
  sendImage,
  sendAudio,
  sendFile,
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
      <span className="shrink-0 text-2xs tabular-nums">{fmtDur(playing || pos ? pos : duration)}</span>
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

/** Иконка по короткой подписи из fileKindLabel — 4 значка на 5 подписей
 *  («Документ PDF» и «Текст» делят FileText), остальное — общий File. */
function fileIconFor(kindLabel: string) {
  if (kindLabel === 'Архив') return FileArchive;
  if (kindLabel === 'Таблица') return FileSpreadsheet;
  if (kindLabel === 'Документ PDF' || kindLabel === 'Текст') return FileText;
  return FileIcon;
}

/** Карточка файла-манифеста: иконка типа, имя, подпись — тип+размер, когда
 *  файл на руках; прогресс сборки или «недоступен», пока нет. */
function FileBubble({ m, own, received }: { m: FamilyMessage; own: boolean; received: number }) {
  const info = m.file!;
  const Icon = fileIconFor(fileKindLabel(info.mime, info.name));
  const available = Boolean(m.fileData);
  // received===0 и своего fileData нет — либо чанки ещё даже не начали
  // приходить (маловероятно долго), либо это старая история и ретеншн
  // сервера (последние 5000 сообщений) их уже вытеснил. Не гадаем откуда —
  // просто честно говорим «недоступен», как и просили в задаче.
  const unavailable = !available && received === 0;
  const subtitle = available
    ? `${fileKindLabel(info.mime, info.name)} · ${formatFileSize(info.size)}`
    : unavailable
      ? 'Файл недоступен'
      : `Получение ${received} из ${info.chunksTotal}`;
  return (
    <div className="flex min-w-[190px] max-w-[240px] items-center gap-2.5 py-0.5">
      <div
        className={`flex size-9 shrink-0 items-center justify-center rounded-full ${own ? 'bg-white/20 text-white' : 'bg-accent/15 text-accent'}`}
      >
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{info.name}</p>
        <p className={`truncate text-2xs ${unavailable ? 'opacity-60' : ''} ${own ? 'text-white/70' : 'text-muted'}`}>
          {subtitle}
        </p>
      </div>
    </div>
  );
}

// Единый порядок сообщений: подтверждённые по seq, неотправленные — в конец
// по времени. Реакции и чанки файлов — служебные записи, в ленте не показываются.
function msgOrder(a: FamilyMessage, b: FamilyMessage): number {
  if (a.seq != null && b.seq != null) return a.seq - b.seq;
  if (a.seq == null && b.seq == null) return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  return a.seq == null ? 1 : -1;
}
function ordered(msgs: FamilyMessage[]): FamilyMessage[] {
  return [...msgs].filter((m) => !m.deletedAt && !m.reaction && !m.fileChunk).sort(msgOrder);
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
  if (min < 60) return `${min}\u00A0мин назад`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}\u00A0ч назад`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'вчера';
  if (d < 7) return `${d}\u00A0дн назад`;
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** Сообщение из одних эмодзи (1–3 графемы): рисуется без пузыря, крупно —
 *  как в больших мессенджерах. Сегментация по графемам, а не по кодпоинтам:
 *  флаги, скин-тоны и ZWJ-связки — это один видимый символ из многих кодов. */
function emojiOnly(text: string): number {
  const t = text.trim();
  if (!t || t.length > 24) return 0;
  const seg = new Intl.Segmenter('ru', { granularity: 'grapheme' });
  const clusters = [...seg.segment(t)].map((x) => x.segment);
  if (clusters.length === 0 || clusters.length > 3) return 0;
  return clusters.every((c) => /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(c))
    ? clusters.length
    : 0;
}

/** Сниппет сообщения для цитаты ответа. */
function snippetOf(m: FamilyMessage): string {
  if (m.text) return m.text.slice(0, 120);
  if (m.image) return 'Фото';
  if (m.audio) return 'Голосовое сообщение';
  if (m.file) return 'Файл';
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
  groupStart,
  groupEnd,
  highlight,
  chips,
  maxOtherRead,
  fileReceived,
  onMenu,
  onReply,
  onHeart,
  onOpenImage,
  onDownloadFile,
  onJumpTo,
  onToggleChip,
}: {
  m: FamilyMessage;
  own: boolean;
  authorName: string | null;
  authorColor: string | null;
  /** Первый/последний в серии подряд идущих сообщений одного автора за день:
   *  имя — только на первом, «хвостик» угла — только на последнем. */
  groupStart: boolean;
  groupEnd: boolean;
  highlight: boolean;
  chips: { emoji: string; count: number; mine: boolean }[] | undefined;
  maxOtherRead: number;
  fileReceived: number;
  onMenu: (m: FamilyMessage) => void;
  onReply: (m: FamilyMessage) => void;
  onHeart: (m: FamilyMessage) => void;
  onOpenImage: (src: string) => void;
  onDownloadFile: (m: FamilyMessage) => void;
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
    const isFile = Boolean(m.file); // весь пузырь файла — одна кликабельная карточка
    const msg = m;
    s.tapTimer = setTimeout(() => {
      s.tapTimer = null;
      if (openImage) onOpenImage(msg.image!);
      else if (isFile) onDownloadFile(msg);
      else onMenu(msg);
    }, DOUBLE_TAP_MS);
  }

  function onPointerCancel() {
    clearLp();
    g.current.mode = 'idle';
    g.current.dx = 0;
    setDragX(0);
  }

  // Крупные эмодзи без пузыря — только у «чистого» эмодзи-сообщения: цитата,
  // фото или файл возвращают обычный пузырь, иначе им не на чем висеть.
  const jumbo = !m.replyTo && !m.image && !m.audio && !m.file ? emojiOnly(m.text) : 0;

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
            className={`cursor-pointer select-none overflow-hidden transition-shadow active:opacity-80 ${
              jumbo
                ? 'bg-transparent px-1 py-0'
                : `rounded-2xl ${m.image ? 'p-1' : 'px-3 py-2'} ${
                    own
                      ? `bg-gradient-to-br from-accent-fill to-accent-2-fill text-white ${groupEnd ? 'rounded-br-md' : ''}`
                      : `bg-surface-2 text-text ${groupEnd ? 'rounded-bl-md' : ''}`
                  }`
            } ${highlight ? 'ring-2 ring-frost' : ''}`}
          >
            {!own && authorName && groupStart && (
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
                <span className={`block text-2xs font-semibold ${own ? 'text-white/90' : 'text-accent'}`}>
                  {m.replyTo.name}
                </span>
                <span className={`block truncate text-xs ${own ? 'text-white/75' : 'text-muted'}`}>
                  {m.replyTo.text}
                </span>
              </button>
            )}
            {m.audio && <AudioBubble src={m.audio} duration={m.audioDur ?? 0} own={own} />}
            {m.file && <FileBubble m={m} own={own} received={fileReceived} />}
            {m.image && (
              <img src={m.image} alt="Фото" loading="lazy" className="block max-h-80 max-w-full rounded-xl" draggable={false} />
            )}
            {m.text && jumbo > 0 && (
              <p className={`leading-none ${jumbo === 1 ? 'text-5xl' : jumbo === 2 ? 'text-4xl' : 'text-3xl'}`}>
                {m.text.trim()}
              </p>
            )}
            {m.text && jumbo === 0 && (
              <p className={`whitespace-pre-wrap break-words text-sm ${m.image ? 'px-2 pt-1' : ''}`}>{m.text}</p>
            )}
            <span className={`mt-0.5 flex items-center justify-end gap-1 text-2xs ${m.image ? 'px-2 pb-1' : ''} ${jumbo ? 'text-muted' : own ? 'text-white/70' : 'text-muted'}`}>
              {m.editedAt && <span>изменено</span>}
              {timeLabel(m.createdAt)}
              {own &&
                (m.status === 'pending' ? (
                  <Clock size={14} />
                ) : m.seq != null && maxOtherRead >= m.seq ? (
                  <CheckCheck size={14} className="text-sky-300" />
                ) : (
                  <Check size={14} />
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

  // Лента открывается чаще любого другого экрана, и заглушка занимает её
  // целиком. Пока Dexie не ответил, «Пока нет сообщений» — неправда, а
  // выглядит как потерянная переписка.
  const loaded = useLoaded(messagesRaw);
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

  // Сколько РАЗНЫХ по idx чанков файла уже долетело до этого устройства —
  // для прогресса «Получение X из N» в карточке ещё не собранного файла.
  const fileChunkCounts = useMemo(() => {
    const byFileId = new Map<string, Set<number>>();
    for (const m of messagesRaw ?? []) {
      if (!m.fileChunk) continue;
      let idxs = byFileId.get(m.fileChunk.fileId);
      if (!idxs) {
        idxs = new Set();
        byFileId.set(m.fileChunk.fileId, idxs);
      }
      idxs.add(m.fileChunk.idx);
    }
    return byFileId;
  }, [messagesRaw]);

  // Presence в шапке чата: онлайн-статус собеседника(ов) + «был(а) в сети …».
  const others = useMemo(
    () => (membersRaw ?? []).filter((m) => !m.leftAt && m.id !== selfId),
    [membersRaw, selfId],
  );
  // Пока фото сжимается и шифруется (или файл режется на чанки), кнопка
  // занята: на большом вложении это заметная пауза, и без индикации человек
  // жмёт второй раз.
  const [sendingImage, setSendingImage] = useState(false);
  const [sendingFile, setSendingFile] = useState(false);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const sendingAttachment = sendingImage || sendingFile;
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
  const imageRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
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
      toast('Не удалось скопировать. Выделите текст вручную');
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
    // Раньше ошибка глоталась молча: человек выбирал фото, ничего не
    // происходило, и понять почему было невозможно. Молчаливый отказ хуже
    // отказа с текстом — второй хотя бы подсказывает, что делать.
    setSendingImage(true);
    try {
      const dataUrl = await compressImage(file);
      await sendImage(familyId, dataUrl);
    } catch (err) {
      if (err instanceof ImageTooLargeError) {
        toast(`Файл больше ${Math.round(MAX_INPUT_BYTES / 1024 / 1024)} МБ — выберите поменьше`);
      } else if (err instanceof ImageDecodeError) {
        // Чаще всего это HEIC с айфона, открытый в стороннем браузере: формат
        // системный, и разобрать его умеет не всякий движок.
        toast('Не удалось открыть фото. Попробуйте другой файл');
      } else {
        toast('Не удалось отправить фото. Проверьте связь');
      }
    } finally {
      setSendingImage(false);
    }
  }

  /** Читает файл целиком в dataURL и режет на чанки — sendFile сам решает,
   *  как их отправить (см. familyChat.ts). Ограничение размера — здесь, а не
   *  внутри sendFile: сообщить человеку до траты времени на FileReader. */
  async function handlePickFile(file: File) {
    if (file.size > MAX_FILE_BYTES) {
      toast('Файл больше 8 МБ — такой не пройдёт через чат');
      return;
    }
    setSendingFile(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result as string);
        fr.onerror = () => reject(new Error('read'));
        fr.readAsDataURL(file);
      });
      await sendFile(familyId, { name: file.name, mime: file.type || 'application/octet-stream', size: file.size, dataUrl });
    } catch {
      toast('Не удалось отправить файл. Проверьте связь');
    } finally {
      setSendingFile(false);
    }
  }

  /** Скачивание готового файла: тап по карточке. Программный <a download> —
   *  сама карточка не может быть настоящей ссылкой без конфликта с жестами
   *  пузыря (свайп-ответ, долгое нажатие — меню). */
  function downloadFile(m: FamilyMessage) {
    if (!m.file || !m.fileData) return;
    const a = document.createElement('a');
    a.href = m.fileData;
    a.download = m.file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
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
      {/* Для группы из нескольких собеседников строка «0 в сети» не сообщает
          ничего, чего человек уже не предполагает, — прячем её, пока никто не
          появился и не печатает. Для одного собеседника показываем всегда:
          «был(а) в сети 2 ч назад» — это ценность, а не шум. */}
      {others.length > 0 &&
        (others.length === 1 ||
          typers.length > 0 ||
          others.some((o) => onlineSet.has(o.id))) && (
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
        items={
          isTouch
            ? [
                { icon: ArrowRight, text: <>Свайп по сообщению вправо — ответить</> },
                { icon: Heart, text: <>Двойной тап — быстрое ❤️</> },
                { icon: Hand, text: <>Тап или удержание — меню: реакции, копировать, править</> },
              ]
            : [
                { icon: ArrowRight, text: <>Потяните сообщение мышью вправо — ответить</> },
                { icon: Heart, text: <>Двойной клик — быстрое ❤️</> },
                { icon: Hand, text: <>Клик — меню: реакции, копировать, править</> },
              ]
        }
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
            loaded && (
              <p className="py-12 text-center text-sm text-muted">Пока нет сообщений. Напишите первым!</p>
            )
          ) : (
            // justify-end: короткая переписка живёт у композера, как во всех
            // мессенджерах, а не болтается в середине экрана. Ритм отступов —
            // по сериям (см. sameGroup), а не одинаковой прокладкой.
            <div className="flex min-h-full flex-col justify-end py-2">
              {list.map((m, i) => {
                const sameGroup = (a: FamilyMessage | undefined, b: FamilyMessage) =>
                  Boolean(
                    a &&
                      !a.system &&
                      !b.system &&
                      a.senderMemberId === b.senderMemberId &&
                      dayKey(a.createdAt) === dayKey(b.createdAt),
                  );
                const groupStart = !sameGroup(list[i - 1], m);
                const groupEnd = !sameGroup(list[i + 1] as FamilyMessage | undefined, m);
                const divider =
                  i === 0 || dayKey(list[i - 1].createdAt) !== dayKey(m.createdAt) ? (
                    <div key={`d-${m.clientMsgId}`} className="flex items-center justify-center py-1.5">
                      <span className="rounded-full bg-surface-2/80 px-3 py-0.5 text-2xs font-medium text-muted">
                        {now ? dayLabel(m.createdAt, now) : ''}
                      </span>
                    </div>
                  ) : null;
                if (m.system) {
                  return (
                    <div key={m.clientMsgId} className="mt-2">
                      {divider}
                      {/* Полупрозрачная плашка: служебные события не должны
                          весить столько же, сколько живые сообщения. */}
                      <div className="py-0.5 text-center">
                        <span className="inline-block rounded-full bg-surface-2/70 px-3 py-1 text-xs text-muted">{m.text}</span>
                      </div>
                    </div>
                  );
                }
                const own = m.senderMemberId === selfId;
                const author = memberMap[m.senderMemberId];
                const chips = reactionChips.get(m.clientMsgId);
                return (
                  <div key={m.clientMsgId} className={groupStart ? 'mt-2.5' : 'mt-0.5'}>
                    {divider}
                    <div data-msg-id={m.clientMsgId}>
                      <MessageRow
                        m={m}
                        own={own}
                        authorName={author?.displayName ?? null}
                        authorColor={author?.color ?? null}
                        groupStart={groupStart}
                        groupEnd={groupEnd}
                        highlight={highlightId === m.clientMsgId}
                        chips={chips}
                        maxOtherRead={maxOtherRead}
                        fileReceived={m.file ? (fileChunkCounts.get(m.file.fileId)?.size ?? 0) : 0}
                        onMenu={setActionMsg}
                        onReply={startReply}
                        onHeart={(msg) => void toggleReaction(msg, '❤️')}
                        onOpenImage={setViewImage}
                        onDownloadFile={downloadFile}
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
            <Reply size={14} className="shrink-0 text-accent" />
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
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-fill to-accent-2-fill text-white active:scale-95"
            >
              <Send size={20} />
            </button>
          </div>
        ) : (
          // Единая капсула ввода на всю ширину: скрепка живёт ВНУТРИ поля
          // (как в больших мессенджерах), снаружи — одна круглая кнопка.
          // Раньше скрепка висела отдельной прозрачной кнопкой слева, и поле
          // выглядело зажатым посередине с рыхлыми пустотами по бокам.
          <div className="flex items-end gap-2 px-3 py-2">
            <input
              ref={imageRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void handlePickImage(f);
              }}
            />
            <input
              ref={docRef}
              type="file"
              accept="*/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void handlePickFile(f);
              }}
            />
            <div className="flex min-w-0 flex-1 items-end rounded-3xl border border-border bg-surface transition-colors focus-within:border-accent">
              <button
                onClick={() => setAttachSheetOpen(true)}
                disabled={sendingAttachment}
                aria-label={sendingAttachment ? 'Вложение отправляется' : 'Прикрепить'}
                aria-busy={sendingAttachment || undefined}
                className="flex size-11 shrink-0 select-none items-center justify-center self-end rounded-full text-muted active:text-accent disabled:opacity-50"
              >
                {sendingAttachment ? (
                  <Loader2 size={20} className="animate-spin motion-reduce:animate-none" />
                ) : (
                  <Paperclip size={20} />
                )}
              </button>
              <textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (e.target.value.trim()) sendTyping(familyId);
                }}
                onKeyDown={(e) => {
                  // На тач-устройствах Enter = перенос строки (отправка — кнопкой):
                  // экранная клавиатура ставит «ввод», а не «отправить».
                  if (e.key === 'Enter' && !e.shiftKey && !isTouch) {
                    e.preventDefault();
                    void submit();
                  }
                }}
                rows={1}
                placeholder="Сообщение…"
                className="max-h-28 min-h-[44px] min-w-0 flex-1 resize-none bg-transparent py-2.5 pl-0.5 pr-4 text-sm leading-tight outline-none"
              />
            </div>
            {text.trim() || !rec.supported ? (
              <button
                onClick={() => void submit()}
                disabled={!text.trim()}
                aria-label="Отправить"
                className="flex size-11 shrink-0 select-none items-center justify-center self-end rounded-full bg-gradient-to-br from-accent-fill to-accent-2-fill text-white disabled:opacity-40 active:scale-95"
              >
                <Send size={20} />
              </button>
            ) : (
              <button
                onClick={() => void rec.start()}
                aria-label="Записать голосовое"
                className="flex size-11 shrink-0 select-none items-center justify-center self-end rounded-full bg-gradient-to-br from-accent-fill to-accent-2-fill text-white active:scale-95"
              >
                <Mic size={20} />
              </button>
            )}
          </div>
        )}
      </div>

      <Sheet open={attachSheetOpen} onClose={() => setAttachSheetOpen(false)} title="Вложение">
        <div className="space-y-2 pb-2">
          <button
            onClick={() => {
              setAttachSheetOpen(false);
              imageRef.current?.click();
            }}
            className="flex w-full items-center gap-3 rounded-xl bg-surface-2 p-3.5 text-left active:opacity-80"
          >
            <ImageIcon size={18} className="text-accent" />
            Фото
          </button>
          <button
            onClick={() => {
              setAttachSheetOpen(false);
              docRef.current?.click();
            }}
            className="flex w-full items-center gap-3 rounded-xl bg-surface-2 p-3.5 text-left active:opacity-80"
          >
            <FileIcon size={18} className="text-accent" />
            Файл
          </button>
        </div>
      </Sheet>

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
                    className={`flex size-10 items-center justify-center rounded-full text-lg transition-transform active:scale-90 ${
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
            {actionMsg.senderMemberId === selfId && !actionMsg.image && !actionMsg.audio && !actionMsg.file && (
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
