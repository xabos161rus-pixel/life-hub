import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Check, Clock, Send } from 'lucide-react';
import { db } from '../../db/db';
import type { FamilyMessage } from '../../db/types';
import { getFamilyConfig } from '../../lib/family/familyState';
import { sendMessage } from '../../lib/family/familyChat';

// Порядок: подтверждённые по seq, неотправленные (seq=null) — в конец по времени.
function ordered(msgs: FamilyMessage[]): FamilyMessage[] {
  return [...msgs]
    .filter((m) => !m.deletedAt)
    .sort((a, b) => {
      if (a.seq != null && b.seq != null) return a.seq - b.seq;
      if (a.seq == null && b.seq == null) return a.createdAt.localeCompare(b.createdAt);
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
  const bottomRef = useRef<HTMLDivElement>(null);

  // Автоскролл к низу при новом сообщении.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [list.length]);

  async function submit() {
    const body = text.trim();
    if (!body) return;
    setText('');
    await sendMessage(body);
  }

  return (
    <div className="flex flex-col">
      {list.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted">Пока нет сообщений. Напишите первым!</p>
      ) : (
        <div className="space-y-2 pb-2">
          {list.map((m) => {
            const own = m.senderMemberId === selfId;
            const author = memberMap[m.senderMemberId];
            return (
              <div key={m.clientMsgId} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] rounded-2xl px-3 py-2 ${own ? 'bg-accent text-white' : 'bg-surface-2 text-text'}`}>
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

      <div className="sticky bottom-0 flex items-end gap-2 bg-bg/95 pt-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
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
          className="max-h-28 min-h-[44px] flex-1 resize-none rounded-2xl border border-border bg-surface px-3 py-2.5 text-[15px]"
        />
        <button
          onClick={() => void submit()}
          disabled={!text.trim()}
          aria-label="Отправить"
          className="flex size-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-2 text-white disabled:opacity-40 active:scale-95"
        >
          <Send size={20} />
        </button>
      </div>
    </div>
  );
}
