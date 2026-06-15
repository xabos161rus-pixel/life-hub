import { useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import { db } from '../../db/db';
import { create } from '../../db/repo';
import { Input } from '../../components/ui/Input';
import { MicButton } from '../../components/ui/MicButton';
import { describeParsed, parseQuickTask } from '../../lib/nlDate';

/**
 * Быстрый ввод задачи в стиле TickTick: одна строка без открытия формы.
 * Текст разбирается parseQuickTask — естественная дата/время уходят в поля,
 * остальное остаётся заголовком. Полная форма (Fab/тап) не затрагивается.
 */
export function QuickAddBar({
  defaultDueDate,
  defaultProjectId,
}: {
  defaultDueDate?: string | null;
  defaultProjectId?: string | null;
}) {
  const [text, setText] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => (text.trim() ? parseQuickTask(text) : null), [text]);
  const hint = parsed ? describeParsed(parsed) : null;

  async function submit() {
    const raw = text.trim();
    if (!raw) return;
    const p = parseQuickTask(raw);
    await create(db.tasks, {
      title: p.title,
      notes: '',
      projectId: defaultProjectId ?? null,
      goalId: null,
      priority: 0,
      dueDate: p.dueDate ?? defaultDueDate ?? null,
      dueTime: p.dueTime,
      completedAt: null,
      checklist: [],
      recurrence: null,
      sortOrder: Date.now(),
    });
    setText('');
    wrapRef.current?.querySelector('input')?.focus();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  }

  const canSend = text.trim().length > 0;

  return (
    <div ref={wrapRef} className="card mb-4 px-3 py-2">
      <div className="flex items-center gap-1">
        <Input
          value={text}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Что нужно сделать?"
          className="border-0 bg-transparent px-1 py-2 focus:ring-0"
        />
        <MicButton onText={(t) => setText((cur) => (cur ? `${cur} ${t}` : t))} />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSend}
          aria-label="Добавить задачу"
          className={`shrink-0 rounded-full p-2 transition-transform active:scale-90 ${
            canSend ? 'text-accent' : 'text-muted opacity-40'
          }`}
        >
          <Send size={20} />
        </button>
      </div>
      {hint && <p className="px-1 pt-0.5 pb-1 text-xs text-accent">{hint}</p>}
    </div>
  );
}
