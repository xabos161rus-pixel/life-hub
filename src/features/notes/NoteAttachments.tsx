// Файлы-вложения под текстом заметки. Картинки сюда не попадают — они живут
// инлайном в самом тексте; здесь всё остальное: PDF, архивы, таблицы.

import { File as FileIcon, FileArchive, FileSpreadsheet, FileText, X } from 'lucide-react';
import type { NoteAttachment } from '../../lib/noteFiles';
import { fileKindLabel, formatFileSize } from '../../lib/noteFiles';
import { HIT_SLOP_44 } from '../../components/ui/hitSlop';

/** Иконка по короткой подписи из fileKindLabel — та же раскладка, что у
 *  карточки файла в семейном чате (там она локальна для фичи, а общий дом ей
 *  выбрать негде: lib без React, а иконки — React-компоненты). */
function iconFor(kindLabel: string) {
  if (kindLabel === 'Архив') return FileArchive;
  if (kindLabel === 'Таблица') return FileSpreadsheet;
  if (kindLabel === 'Документ PDF' || kindLabel === 'Текст') return FileText;
  return FileIcon;
}

/** Скачивание по тапу: программный <a download> — как в чате. */
function download(a: NoteAttachment) {
  if (!a.data) return;
  const el = document.createElement('a');
  el.href = a.data;
  el.download = a.name;
  document.body.appendChild(el);
  el.click();
  el.remove();
}

export function NoteAttachments({
  files,
  onDelete,
}: {
  files: NoteAttachment[];
  onDelete: (fileId: string) => void;
}) {
  if (files.length === 0) return null;
  return (
    <div className="mt-4 space-y-2" data-testid="note-attachments">
      {files.map((f) => {
        const kind = fileKindLabel(f.mime, f.name);
        const Icon = iconFor(kind);
        const ready = Boolean(f.data);
        return (
          <div key={f.fileId} className="card flex items-center gap-3 p-3">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-60"
              onClick={() => download(f)}
              disabled={!ready}
              aria-label={`Скачать ${f.name}`}
            >
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                <Icon size={20} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{f.name}</span>
                <span className="block text-xs text-muted">
                  {/* Чанки ещё едут синком с другого устройства — честное
                      «получение», а не карточка, притворяющаяся готовой. */}
                  {ready ? `${kind} · ${formatFileSize(f.size)}` : 'Получение…'}
                </span>
              </span>
            </button>
            <button
              type="button"
              aria-label={`Удалить ${f.name}`}
              className={`shrink-0 rounded-lg p-2 text-muted active:bg-surface-2 ${HIT_SLOP_44}`}
              onClick={() => onDelete(f.fileId)}
            >
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
