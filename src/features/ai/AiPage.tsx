import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowUp, Copy, MessageSquarePlus, PanelsTopLeft, RotateCcw, Sparkles, Square } from 'lucide-react';
import { Screen } from '../../components/layout/Screen';
import { useToast } from '../../components/ui/toastContext';
import { EmptyState } from '../../components/ui/EmptyState';
import type { LlmMessage } from '../../db/types';
import { requestChat, aiErrorText } from '../../lib/ai/aiClient';
import { formatCost, modelLabel } from '../../lib/ai/models';
import {
  addAssistantMessage,
  addErrorMessage,
  addUserMessage,
  chatMessages,
  createChat,
  listChats,
  removeMessage,
  toContext,
} from '../../lib/ai/llmRepo';
import { t } from '../../lib/i18n';
import { Markdown } from './Markdown';
import { ChatListSheet } from './ChatListSheet';

// Акцент раздела — клай Claude Code. Перекрываем только акцентные переменные на
// обёртке, как это делает FocusPage: нейтрали приложения остаются общими.
const CC_THEME: CSSProperties = {
  '--app-accent': 'var(--cc-accent)',
  '--app-accent-2': 'var(--cc-accent-2)',
} as CSSProperties;

export function AiPage() {
  const toast = useToast();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const creating = useRef(false);

  // БЕЗ значения по умолчанию: undefined = «ещё грузится», [] = «чатов нет».
  // С дефолтом [] эти состояния неразличимы, и эффект ниже успевал завести
  // лишний пустой чат до того, как подтянутся существующие.
  const chats = useLiveQuery(() => listChats(), []);
  const list = chats ?? [];
  // Активный чат — производное значение, а НЕ состояние, выставленное из
  // эффекта: синхронный setState в эффекте даёт каскадные рендеры.
  const chat = (pickedId ? list.find((c) => c.id === pickedId) : null) ?? list[0] ?? null;
  const chatId = chat?.id ?? null;
  const messages = useLiveQuery(
    () => (chatId ? chatMessages(chatId) : Promise.resolve([])),
    [chatId],
    [] as LlmMessage[],
  );

  // Пустой раздел: заводим первый чат. Запись идёт в Dexie — внешнюю систему,
  // результат придёт через useLiveQuery, поэтому setState здесь не нужен.
  // Флаг-страховка от повторного создания, пока запрос не завершился.
  useEffect(() => {
    if (chats === undefined || chats.length || creating.current) return;
    creating.current = true;
    void createChat().finally(() => {
      creating.current = false;
    });
  }, [chats]);

  // Автоскролл к последнему сообщению. 'auto', а не 'smooth': плавная прокрутка
  // на каждый ответ на iOS конфликтует с инерцией и дёргает ленту.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, busy]);

  // Отмена запроса при уходе с экрана — иначе платим за токены впустую и
  // пишем в состояние размонтированного компонента.
  useEffect(() => () => abortRef.current?.abort(), []);

  async function handleSend() {
    const text = draft.trim();
    if (!text || busy || !chat) return;
    setDraft('');
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await addUserMessage(chat, text);
      const history = toContext(await chatMessages(chat.id));
      const reply = await requestChat({
        messages: history,
        systemPrompt: chat.systemPrompt,
        model: chat.model,
        signal: ac.signal,
      });
      await addAssistantMessage(chat.id, reply);
    } catch (e) {
      await addErrorMessage(chat.id, aiErrorText(e));
    } finally {
      abortRef.current = null;
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  /** Повтор: снимаем прошлый ответ и спрашиваем заново тем же контекстом. */
  async function handleRetry(m: LlmMessage) {
    if (busy || !chat) return;
    setBusy(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await removeMessage(m.id);
      const history = toContext(await chatMessages(chat.id));
      const reply = await requestChat({
        messages: history,
        systemPrompt: chat.systemPrompt,
        model: chat.model,
        signal: ac.signal,
      });
      await addAssistantMessage(chat.id, reply);
    } catch (e) {
      await addErrorMessage(chat.id, aiErrorText(e));
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function handleNewChat() {
    const c = await createChat();
    setPickedId(c.id);
    setListOpen(false);
    setDraft('');
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('Скопировано'));
    } catch {
      toast(t('Не удалось скопировать'));
    }
  }

  return (
    <div style={CC_THEME} className="h-full">
      <Screen
        title={chat?.title ?? t('ИИ')}
        backTo="/home"
        fill
        right={
          <div className="flex items-center gap-1">
            <button
              aria-label={t('Список чатов')}
              className="p-2 text-accent active:opacity-60"
              onClick={() => setListOpen(true)}
            >
              <PanelsTopLeft size={22} />
            </button>
            <button
              aria-label={t('Новый чат')}
              className="p-2 text-accent active:opacity-60"
              onClick={() => void handleNewChat()}
            >
              <MessageSquarePlus size={22} />
            </button>
          </div>
        }
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-3">
            {!messages.length && (
              <EmptyState
                icon={Sparkles}
                title={t('Спросите что угодно')}
                hint={t('Пока отвечает заглушка — провайдер подключается на следующем шаге.')}
              />
            )}
            {messages.map((m) =>
              m.role === 'user' ? (
                <UserBubble key={m.id} message={m} />
              ) : (
                <AssistantBlock
                  key={m.id}
                  message={m}
                  onCopy={() => void copyText(m.content)}
                  onRetry={() => void handleRetry(m)}
                  busy={busy}
                />
              ),
            )}
            {busy && <Thinking />}
            <div ref={bottomRef} />
          </div>

          <Composer
            ref={inputRef}
            value={draft}
            busy={busy}
            onChange={setDraft}
            onSend={() => void handleSend()}
            onStop={() => abortRef.current?.abort()}
          />
        </div>
      </Screen>

      <ChatListSheet
        open={listOpen}
        chats={list}
        activeId={chatId}
        onClose={() => setListOpen(false)}
        onPick={(id) => {
          setPickedId(id);
          setListOpen(false);
        }}
        onNew={() => void handleNewChat()}
      />
    </div>
  );
}

/** Вопрос — пузырь справа. Ответ пузырём не оформляем: в Claude Code это поток
 *  на всю ширину, и такая асимметрия узнаётся сразу. */
function UserBubble({ message }: { message: LlmMessage }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-surface-2 px-3.5 py-2.5 whitespace-pre-wrap">
        {message.content}
      </div>
    </div>
  );
}

function AssistantBlock({
  message,
  onCopy,
  onRetry,
  busy,
}: {
  message: LlmMessage;
  onCopy: () => void;
  onRetry: () => void;
  busy: boolean;
}) {
  const failed = message.status === 'error';
  const cost = formatCost(message.costRub);
  return (
    <div className="grid grid-cols-[1.25rem_1fr] gap-x-1">
      <div aria-hidden className="pt-2">
        <span className={`block size-1.5 rounded-full ${failed ? 'bg-danger' : 'bg-accent'}`} />
      </div>
      <div className="min-w-0">
        {failed ? (
          <p className="text-sm text-danger">{message.error}</p>
        ) : (
          <Markdown text={message.content} />
        )}
        <div className="mt-1.5 flex items-center gap-3 font-mono text-[0.7rem] text-muted">
          {!failed && message.tokensIn !== null && (
            <span>
              {message.tokensIn}→{message.tokensOut}
              {cost && ` · ${cost}`}
            </span>
          )}
          {!failed && message.model && <span className="truncate">{modelLabel(message.model)}</span>}
          {!failed && (
            <button aria-label={t('Скопировать')} className="p-1 active:opacity-60" onClick={onCopy}>
              <Copy size={13} />
            </button>
          )}
          <button aria-label={t('Повторить')} className="p-1 active:opacity-60 disabled:opacity-30" disabled={busy} onClick={onRetry}>
            <RotateCcw size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

function Thinking() {
  return (
    <div className="grid grid-cols-[1.25rem_1fr] gap-x-1">
      <div aria-hidden className="pt-2">
        <span className="block size-1.5 animate-pulse rounded-full bg-accent" />
      </div>
      <p className="font-mono text-xs text-muted">{t('думает…')}</p>
    </div>
  );
}

interface ComposerProps {
  value: string;
  busy: boolean;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  ref?: React.Ref<HTMLTextAreaElement>;
}

function Composer({ value, busy, onChange, onSend, onStop, ref }: ComposerProps) {
  return (
    <div className="shrink-0 border-t border-hairline pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          value={value}
          rows={1}
          placeholder={t('Сообщение…')}
          className="max-h-40 min-h-11 flex-1 resize-none rounded-2xl bg-surface-2 px-3.5 py-2.5 outline-none"
          onChange={(e) => {
            onChange(e.target.value);
            // Авторост: сбрасываем высоту перед замером, иначе поле не сжимается.
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={(e) => {
            // Enter отправляет только с курсором и физической клавиатурой:
            // на телефоне это перевод строки, иначе писать многострочное нельзя.
            if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
              e.preventDefault();
              onSend();
            }
          }}
        />
        {busy ? (
          <button
            aria-label={t('Остановить')}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-surface-2 active:opacity-70"
            onClick={onStop}
          >
            <Square size={16} />
          </button>
        ) : (
          <button
            aria-label={t('Отправить')}
            disabled={!value.trim()}
            className="grid size-11 shrink-0 place-items-center rounded-full bg-accent text-white transition-opacity active:opacity-80 disabled:opacity-30"
            onClick={onSend}
          >
            <ArrowUp size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
