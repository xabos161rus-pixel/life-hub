import { MessageSquarePlus, Trash2 } from 'lucide-react';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import type { LlmChat } from '../../db/types';
import { removeChat } from '../../lib/ai/llmRepo';
import { t } from '../../lib/i18n';

/** «26 июл, 18:40» — ISO-метка сообщения, а не дата-ключ (formatRu тут не подходит). */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface Props {
  open: boolean;
  chats: LlmChat[];
  activeId: string | null;
  onClose: () => void;
  onPick: (id: string) => void;
  onNew: () => void;
}

export function ChatListSheet({ open, chats, activeId, onClose, onPick, onNew }: Props) {
  async function handleRemove(chat: LlmChat) {
    if (!window.confirm(t('Удалить чат «{title}» со всей перепиской?', { title: chat.title }))) return;
    await removeChat(chat.id);
  }

  return (
    <Sheet open={open} onClose={onClose} title={t('Чаты')}>
      <div className="space-y-2">
        <Button className="w-full inline-flex items-center justify-center gap-2" onClick={onNew}>
          <MessageSquarePlus size={18} />
          {t('Новый чат')}
        </Button>
        {chats.map((c) => (
          <div
            key={c.id}
            className={`flex items-center gap-2 rounded-xl px-3 py-2.5 ${
              c.id === activeId ? 'bg-surface-2' : ''
            }`}
          >
            <button className="min-w-0 flex-1 text-left active:opacity-60" onClick={() => onPick(c.id)}>
              <span className="block truncate font-medium">{c.title}</span>
              <span className="block text-xs text-muted">{formatWhen(c.lastMessageAt ?? c.createdAt)}</span>
            </button>
            <button
              aria-label={t('Удалить чат')}
              className="p-2 text-muted active:opacity-60"
              onClick={() => void handleRemove(c)}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
