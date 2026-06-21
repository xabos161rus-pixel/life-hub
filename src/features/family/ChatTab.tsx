import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Clock, Send, Pencil, Trash2, X } from 'lucide-react';
import { db } from '../../db/db';
import type { FamilyMessage } from '../../db/types';
import { Sheet } from '../../components/ui/Sheet';
import { getFamilyConfig } from '../../lib/family/familyState';
import { sendMessage, editMessage, deleteMessage } from '../../lib/family/familyChat';

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

export function ChatTab() {
  const messagesRaw = useLiveQuery(() => db.familyMessages.toArray(), []);
  const membersRaw = useLiveQuery(() => db.familyMembers.toArray(), []);
  const config = useLiveQuery(() => getFamilyConfig(), []);
  const selfId = config?.selfMemberId;

  const memberMap = useMemo(() => Object.fromEntries((membersRaw ?? []).map((m) => [m.id, m])), [membersRaw]);
  const list = useMemo(() => ordered(messagesRaw ?? []), [messagesRaw]);

  const [text, setText] = useState('');
  const [actionMsg, setActionMsg] = useState<FamilyMessage | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Автоскролл к низу при новом сообщении — только если уже у низа ленты
  // (иначе при чтении истории чужое сообщение дёргало бы прокрутку вверх).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (nearBottom) bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [list.length]);

  async function submit() {
    const body = text.trim();
    if (!body) return;
    setText('');
    if (editingId) {
      const id = editingId;
      setEditingId(null);
      await editMessage(id, body);
    } else {
      await sendMessage(body);
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
    await deleteMessage(m.clientMsgId);
  }

  return (
    // Полная высота под чат от каркаса (Screen fill): лента растёт и скроллится,
    // композер прибит к низу. Без magic-number — высоту даёт родитель.
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-1">
        {list.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted">Пока нет сообщений. Напишите первым!</p>
        ) : (
          <div className="space-y-2 py-2">
            {list.map((m) => {
            const own = m.senderMemberId === selfId;
            const author = memberMap[m.senderMemberId];
            return (
              <div key={m.clientMsgId} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                <div
                  onClick={() => setActionMsg(m)}
                  className={`max-w-[80%] cursor-pointer rounded-2xl px-3 py-2 active:opacity-80 ${own ? 'bg-accent text-white' : 'bg-surface-2 text-text'}`}
                >
                  {!own && author && (
                    <p className="mb-0.5 text-xs font-semibold" style={{ color: author.color }}>
                      {author.displayName}
                    </p>
                  )}
                  <p className="whitespace-pre-wrap break-words text-[15px]">{m.text}</p>
                  <span className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${own ? 'text-white/70' : 'text-muted'}`}>
                    {timeLabel(m.createdAt)}
                    {own && (m.status === 'acked' ? <Check size={11} /> : <Clock size={11} />)}
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
        <div className="flex items-end gap-2 px-0.5 pt-2">
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
          <button
            onClick={() => void submit()}
            disabled={!text.trim()}
            aria-label="Отправить"
            className="flex size-11 shrink-0 select-none items-center justify-center self-end rounded-full bg-gradient-to-br from-accent to-accent-2 text-white disabled:opacity-40 active:scale-95"
          >
            <Send size={20} />
          </button>
        </div>
      </div>

      <Sheet open={actionMsg !== null} onClose={() => setActionMsg(null)} title="Сообщение">
        {actionMsg && (
          <div className="space-y-2 pb-2">
            <button
              onClick={() => startEdit(actionMsg)}
              className="flex w-full items-center gap-3 rounded-xl bg-surface-2 p-3.5 text-left active:opacity-80"
            >
              <Pencil size={18} className="text-accent" />
              Редактировать
            </button>
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
