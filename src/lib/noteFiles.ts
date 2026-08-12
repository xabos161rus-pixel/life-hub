// Файлы-вложения заметок: нарезка при сохранении и сборка при чтении.
//
// Хранение — чанками в таблице noteFiles (почему не одной записью — см.
// NoteFile в db/types.ts). Механика нарезки/сборки dataURL общая с семейным
// чатом (family/fileTransfer.ts): строковые срезы, сборка конкатенацией,
// терпимость к дублям и произвольному порядку уже проверены там юнитами.

import type { NoteFile } from '../db/types';
import {
  MAX_FILE_BYTES,
  assembleFile,
  fileKindLabel,
  formatFileSize,
  splitDataUrl,
} from './family/fileTransfer';

export { MAX_FILE_BYTES, fileKindLabel, formatFileSize };

/** Вложение глазами UI: метаданные + содержимое, когда все чанки на месте. */
export interface NoteAttachment {
  fileId: string;
  name: string;
  mime: string;
  size: number;
  /** dataURL целиком; undefined — часть чанков ещё не доехала синком. */
  data?: string;
}

/** Заготовки чанк-записей для create(): без id и штампов — их ставит repo. */
export function planNoteFileChunks(
  noteId: string,
  fileId: string,
  meta: { name: string; mime: string; size: number },
  dataUrl: string,
): Array<Omit<NoteFile, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>> {
  const pieces = splitDataUrl(dataUrl);
  return pieces.map((data, idx) => ({
    noteId,
    fileId,
    idx,
    total: pieces.length,
    name: meta.name,
    mime: meta.mime,
    size: meta.size,
    data,
  }));
}

/** Собирает вложения заметки из её чанков. Порядок — по имени, затем по
 *  fileId: стабильный от перезагрузки к перезагрузке, а «по времени
 *  добавления» чанки не хранят. Неполное вложение (часть чанков ещё едет
 *  синком с другого устройства) возвращается без data — карточка честно
 *  покажет «получение», а не битый файл. */
export function groupNoteAttachments(rows: NoteFile[]): NoteAttachment[] {
  const byFile = new Map<string, NoteFile[]>();
  for (const r of rows) {
    if (r.deletedAt) continue;
    const list = byFile.get(r.fileId);
    if (list) list.push(r);
    else byFile.set(r.fileId, [r]);
  }
  const out: NoteAttachment[] = [];
  for (const [fileId, chunks] of byFile) {
    const head = chunks[0];
    out.push({
      fileId,
      name: head.name,
      mime: head.mime,
      size: head.size,
      data: assembleFile(chunks, head.total),
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.fileId.localeCompare(b.fileId));
}
