// Фотографии задач: нарезка при сохранении и сборка при чтении.
//
// Хранение — кусками в таблице taskPhotos, ровно по образцу вложений заметок
// (lib/noteFiles.ts). Механика нарезки и сборки общая с семейным чатом
// (family/fileTransfer.ts): строковые срезы, сборка конкатенацией, терпимость
// к дублям и произвольному порядку — там это уже проверено юнитами.
//
// Отличие от вложений заметок одно, и оно важное: id куска считается ИЗ
// СОДЕРЖИМОГО. Старые задачи перекладывают в новый формат оба устройства
// независимо друг от друга, и со случайными идентификаторами получились бы два
// комплекта одних и тех же снимков — оба уехали бы на сервер и остались там.

import type { TaskPhoto } from '../db/types';
import { sha256hex } from './crypto';
import { assembleFile, splitDataUrl } from './family/fileTransfer';

/** Идентификатор снимка — от содержимого, а не случайный. */
export function photoIdOf(dataUrl: string): Promise<string> {
  return sha256hex(dataUrl);
}

/** Заготовки кусков одного снимка: id считается из photoId и номера куска,
 *  поэтому повторное перекладывание той же задачи даёт те же записи. */
export function planPhotoChunks(
  taskId: string,
  photoId: string,
  dataUrl: string,
): Array<{ id: string; row: Omit<TaskPhoto, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> }> {
  const pieces = splitDataUrl(dataUrl);
  return pieces.map((data, idx) => ({
    id: `${photoId}_${idx}`,
    row: { taskId, photoId, idx, total: pieces.length, data },
  }));
}

/** Собрать снимки задачи из кусков.
 *
 *  Порядок — по photoId: он же хеш содержимого, то есть стабилен от запуска к
 *  запуску и одинаков на обоих устройствах. Снимок, у которого не хватает
 *  куска (часть ещё едет синком), пропускается: лучше показать три снимка из
 *  четырёх, чем битую картинку. */
export function assemblePhotos(rows: TaskPhoto[]): string[] {
  const byPhoto = new Map<string, TaskPhoto[]>();
  for (const r of rows) {
    if (r.deletedAt) continue;
    const list = byPhoto.get(r.photoId);
    if (list) list.push(r);
    else byPhoto.set(r.photoId, [r]);
  }
  const out: string[] = [];
  for (const photoId of [...byPhoto.keys()].sort()) {
    const chunks = byPhoto.get(photoId)!;
    const data = assembleFile(
      chunks.map((c) => ({ idx: c.idx, data: c.data })),
      chunks[0].total,
    );
    if (data) out.push(data);
  }
  return out;
}
