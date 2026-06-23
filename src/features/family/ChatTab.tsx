import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, CheckCheck, Clock, Send, Pencil, Trash2, X, ImagePlus, Mic, Play, Pause } from 'lucide-react';
import { db } from '../../db/db';
import type { FamilyMessage } from '../../db/types';
import { Sheet } from '../../components/ui/Sheet';
import { compressImage } from '../../lib/image';
import { getFamilyConfig } from '../../lib/family/familyState';
import { sendMessage, sendImage, sendAudio, editMessage, deleteMessage, subscribeReads, markSeen } from '../../lib/family/familyChat';
import { useVoiceRecorder } from './useVoiceRecorder';

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

// Порядок: подтверждённые по seq, неотправленные (seq=null) — в конец по времени.
function ordered(msgs: FamilyMessage[]): FamilyMessage[] {
  return [...msgs]
    .filter((m) => !m.deletedAt)
    .sort((a, b) => {
      if (a.seq != null && b.seq != null) return a.seq - b.seq;
      if (a.seq == null && b.seq == null) return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
      return a.seq == null ? 1 : -1;
    });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function ChatTab({ familyId }: { familyId: string }) {
  const messagesRaw = useLiveQuery(() => db.familyMessages.where('familyId').equals(familyId).toArray(), [familyId]);
  const membersRaw = useLiveQuery(() => db.familyMembers.where('familyId').equals(familyId).toArray(), [familyId]);
  const config = useLiveQuery(() => getFamilyConfig(familyId), [familyId]);
  const selfId = config?.selfMemberId;

  const memberMap = useMemo(() => Object.fromEntries((membersRaw ?? []).map((m) => [m.id, m])), [membersRaw]);
  const list = useMemo(() => ordered(messagesRaw ?? []), [messagesRaw]);

  const [text, setText] = useState('');
  const [actionMsg, setActionMsg] = useState<FamilyMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
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

  async function submit() {
    const body = text.trim();
    if (!body) return;
    setText('');
    if (editingId) {
      const id = editingId;
      setEditingId(null);
      await editMessage(familyId, id, body);
    } else {
      await sendMessage(familyId, body);
    }
  }

  function startEdit(m: FamilyMessage) {
    setEditingId(m.clientMsgId);
    setText(m.text);
    setActionMsg(null);
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

  return (
    // Полная высота под чат от каркаса (Screen fill): лента растёт и скроллится,
    // композер прибит к низу. Без magic-number — высоту даёт родитель.
    <div className="flex h-full min-h-0 flex-col">
      {/* overscroll-contain: флик до края ленты НЕ чейнится в App-контейнер —
          без этого на iOS-momentum «война скроллов» с предком насыщала
          main-thread и чат замирал после прокруток вверх-вниз. */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1">
        {list.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">Пока нет сообщений. Напишите первым!</p>
        ) : (
          <div className="space-y-2 py-2">
            {list.map((m) => {
            if (m.system) {
              return (
                <div key={m.clientMsgId} className="py-1 text-center">
                  <span className="inline-block rounded-full bg-surface-2 px-3 py-1 text-xs text-muted">{m.text}</span>
                </div>
              );
            }
            const own = m.senderMemberId === selfId;
            const author = memberMap[m.senderMemberId];
            return (
              <div key={m.clientMsgId} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                <div
                  onClick={() => setActionMsg(m)}
                  className={`max-w-[80%] cursor-pointer overflow-hidden rounded-2xl active:opacity-80 ${
                    m.image ? 'p-1' : 'px-3 py-2'
                  } ${own ? 'bg-accent text-white' : 'bg-surface-2 text-text'}`}
                >
                  {!own && author && (
                    <p className={`mb-0.5 text-xs font-semibold ${m.image ? 'px-2 pt-1' : ''}`} style={{ color: author.color }}>
                      {author.displayName}
                    </p>
                  )}
                  {m.audio && <AudioBubble src={m.audio} duration={m.audioDur ?? 0} own={own} />}
                  {m.image && (
                    <img src={m.image} alt="Фото" loading="lazy" className="block max-h-80 max-w-full rounded-xl" />
                  )}
                  {m.text && (
                    <p className={`whitespace-pre-wrap break-words text-[15px] ${m.image ? 'px-2 pt-1' : ''}`}>{m.text}</p>
                  )}
                  <span className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${m.image ? 'px-2 pb-1' : ''} ${own ? 'text-white/70' : 'text-muted'}`}>
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
            );
          })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-hairline bg-bg pb-[calc(env(safe-area-inset-bottom)+6px)]">
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
        {rec.recording ? (
          <div className="flex items-center gap-3 px-1 pt-2">
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
          <div className="flex items-end gap-2 px-0.5 pt-2">
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
              className="flex size-11 shrink-0 select-none items-center justify-center self-end rounded-full bg-surface-2 text-accent active:scale-95"
            >
              <ImagePlus size={20} />
            </button>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={1}
              placeholder="Сообщение…"
              className="max-h-28 min-h-[44px] min-w-0 flex-1 resize-none rounded-2xl border border-border bg-surface px-3 py-2.5 text-[15px] outline-none focus:border-accent"
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
            {!actionMsg.image && !actionMsg.audio && (
              <button
                onClick={() => startEdit(actionMsg)}
                className="flex w-full items-center gap-3 rounded-xl bg-surface-2 p-3.5 text-left active:opacity-80"
              >
                <Pencil size={18} className="text-accent" />
                Редактировать
              </button>
            )}
            <button
              onClick={() => void doDelete(actionMsg)}
              className="flex w-full items-center gap-3 rounded-xl bg-danger/15 p-3.5 text-left text-danger active:opacity-80"
            >
              <Trash2 size={18} />
              Удалить
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
