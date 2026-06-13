import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import DOMPurify from 'dompurify';
import { Pin, Trash2 } from 'lucide-react';
import { marked } from 'marked';
import { useNavigate, useParams } from 'react-router';
import { Screen } from '../../components/layout/Screen';
import { Input, Textarea } from '../../components/ui/Input';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { db } from '../../db/db';
import { create, remove, update } from '../../db/repo';

const AUTOSAVE_MS = 800;

type EditorMode = 'edit' | 'preview';

/** Ручная стилизация markdown-вывода — плагина typography в проекте нет. */
const PROSE_CLASS =
  'text-[15px] leading-relaxed ' +
  '[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold ' +
  '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-bold ' +
  '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-lg [&_h3]:font-semibold ' +
  '[&_p]:my-2 ' +
  '[&_a]:text-accent [&_a]:underline ' +
  '[&_strong]:font-bold [&_em]:italic ' +
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 ' +
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_li]:my-0.5 ' +
  '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-accent ' +
  '[&_blockquote]:pl-3 [&_blockquote]:text-muted ' +
  '[&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[13px] ' +
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:bg-surface-2 [&_pre]:p-3 ' +
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 ' +
  '[&_hr]:my-4 [&_hr]:border-border ' +
  '[&_img]:max-w-full [&_img]:rounded-xl ' +
  '[&_table]:my-2 [&_table]:w-full [&_th]:border [&_th]:border-border [&_th]:p-1.5 ' +
  '[&_td]:border [&_td]:border-border [&_td]:p-1.5';

function parseTags(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  );
}

export function NoteEditorPage() {
  const { id: routeId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = routeId === 'new';

  const [title, setTitle] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [content, setContent] = useState('');
  const [pinned, setPinned] = useState(false);
  const [mode, setMode] = useState<EditorMode>('edit');
  const [saved, setSaved] = useState(false);

  // Актуальные значения полей для flush из таймера/cleanup.
  const stateRef = useRef({ title, tagsInput, content, pinned });
  useEffect(() => {
    stateRef.current = { title, tagsInput, content, pinned };
  });

  const savedIdRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const deletedRef = useRef(false);
  const initializedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Одноразовая загрузка заметки в форму. Live-binding редактору вреден:
  // автосохранение перетирало бы поля под руками пользователя.
  useEffect(() => {
    // savedIdRef-guard: после создания new-заметки и replace URL эффект
    // перезапустится — не перетираем форму уже устаревшим состоянием из БД.
    if (isNew || !routeId || initializedRef.current || savedIdRef.current) return;
    let cancelled = false;
    void db.notes.get(routeId).then((n) => {
      if (cancelled || !n || n.deletedAt || initializedRef.current) return;
      initializedRef.current = true;
      savedIdRef.current = n.id;
      setTitle(n.title);
      setTagsInput(n.tags.join(', '));
      setContent(n.content);
      setPinned(n.pinned);
    });
    return () => {
      cancelled = true;
    };
  }, [routeId, isNew]);

  const flush = useCallback(async () => {
    if (deletedRef.current || !dirtyRef.current) return;
    dirtyRef.current = false;
    const s = stateRef.current;
    const data = {
      title: s.title.trim(),
      content: s.content,
      tags: parseTags(s.tagsInput),
      pinned: s.pinned,
    };
    if (savedIdRef.current) {
      await update(db.notes, savedIdRef.current, data);
    } else {
      const created = await create(db.notes, data);
      savedIdRef.current = created.id;
      navigate(`/more/notes/${created.id}`, { replace: true });
    }
    setSaved(true);
  }, [navigate]);

  const touch = useCallback(() => {
    dirtyRef.current = true;
    setSaved(false);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void flush();
    }, AUTOSAVE_MS);
  }, [flush]);

  // Сохранение при размонтировании (уход со страницы).
  useEffect(
    () => () => {
      clearTimeout(timerRef.current);
      void flush();
    },
    [flush],
  );

  const handleDelete = async () => {
    if (!window.confirm('Удалить заметку?')) return;
    deletedRef.current = true;
    clearTimeout(timerRef.current);
    if (savedIdRef.current) await remove(db.notes, savedIdRef.current);
    navigate('/more/notes');
  };

  const togglePin = () => {
    setPinned((p) => !p);
    touch();
  };

  const previewHtml =
    mode === 'preview'
      ? DOMPurify.sanitize(marked.parse(content, { async: false }) as string)
      : '';

  return (
    <Screen
      title={isNew ? 'Новая заметка' : 'Заметка'}
      backTo="/more/notes"
      right={
        <div className="flex items-center gap-1">
          <button
            onClick={togglePin}
            aria-label={pinned ? 'Открепить' : 'Закрепить'}
            className={`p-2 ${pinned ? 'text-accent' : 'text-muted'}`}
          >
            <Pin size={20} fill={pinned ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={() => void handleDelete()}
            aria-label="Удалить"
            className="p-2 text-danger"
          >
            <Trash2 size={20} />
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        <Input
          value={title}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setTitle(e.target.value);
            touch();
          }}
          placeholder="Заголовок"
          className="text-lg font-semibold"
        />
        <Input
          value={tagsInput}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setTagsInput(e.target.value);
            touch();
          }}
          placeholder="Теги через запятую"
        />
        <div className="flex items-center gap-3">
          <div className="flex-1">
            <SegmentedControl<EditorMode>
              options={[
                { value: 'edit', label: 'Редактор' },
                { value: 'preview', label: 'Просмотр' },
              ]}
              value={mode}
              onChange={setMode}
            />
          </div>
          <span
            className={`shrink-0 text-xs text-muted transition-opacity ${saved ? 'opacity-100' : 'opacity-0'}`}
          >
            Сохранено
          </span>
        </div>
        {mode === 'edit' ? (
          <Textarea
            value={content}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
              setContent(e.target.value);
              touch();
            }}
            placeholder="Текст заметки… поддерживается Markdown"
            className="min-h-[50dvh]"
          />
        ) : content.trim() ? (
          <div className={PROSE_CLASS} dangerouslySetInnerHTML={{ __html: previewHtml }} />
        ) : (
          <p className="py-8 text-center text-sm text-muted">Нет текста для просмотра</p>
        )}
      </div>
    </Screen>
  );
}
