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
import { db } from '../db/db';
import { createWithId, remove } from '../db/repo';
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

/** Привести куски задачи в соответствие с её снимками.
 *
 *  Это «двойная запись» переходного периода: снимки по-прежнему лежат в строке
 *  задачи (иначе устройство на старой версии, применив такую задачу, затёрло бы
 *  ими свои), и одновременно раскладываются кусками здесь.
 *
 *  Строку задачи функция НЕ трогает — ни поля, ни время правки. Это важно:
 *  фоновое перекладывание не должно выглядеть как правка задачи, иначе оно
 *  затрёт на сервере изменения, которые второе устройство ещё не забрало.
 *
 *  Идемпотентна: комплект кусков определяется содержимым снимка, поэтому
 *  повторный вызов (второе устройство, повторный запуск после обрыва) ничего
 *  не дублирует. */
export async function syncTaskPhotos(taskId: string, photos: string[]): Promise<void> {
  const wanted = new Map<string, string>();
  for (const photo of photos) wanted.set(await photoIdOf(photo), photo);

  const existing = await db.taskPhotos.where('taskId').equals(taskId).toArray();
  const have = new Set(existing.filter((r) => !r.deletedAt).map((r) => r.photoId));

  // Недостающие снимки раскладываем кусками.
  for (const [photoId, dataUrl] of wanted) {
    if (have.has(photoId)) continue;
    for (const { id, row } of planPhotoChunks(taskId, photoId, dataUrl)) {
      await createWithId(db.taskPhotos, id, row);
    }
  }

  // Снимки, которых в задаче больше нет, помечаем удалёнными — иначе
  // удалённая фотография вернулась бы при следующем чтении из кусков.
  for (const row of existing) {
    if (row.deletedAt || wanted.has(row.photoId)) continue;
    await remove(db.taskPhotos, row.id);
  }
}

/** Разложить кусками снимки задач, которые ещё лежат только в строке.
 *
 *  Идёт порциями и возвращает, сколько задач обработала: вызывающий может
 *  продолжать, пока не вернётся ноль. Порционно — потому что на телефоне это
 *  фоновая работа, и перекладывать сотню задач с фотографиями одним заходом
 *  значит занять поток на секунды.
 *
 *  Строку задачи не трогает вовсе, поэтому обрыв посередине безобиден:
 *  оригиналы на месте, следующий заход доделает. Порядок именно такой —
 *  сначала куски, и только потом (уже в следующем релизе) поле photos.
 */
export async function migrateTaskPhotos(limit = 5): Promise<number> {
  const tasks = await db.tasks
    .filter((t) => !t.deletedAt && Array.isArray(t.photos) && t.photos.length > 0)
    .limit(limit * 4)
    .toArray();

  let done = 0;
  for (const task of tasks) {
    if (done >= limit) break;
    const photos = task.photos ?? [];
    // Уже разложена? Считаем по составу, а не по числу: снимок могли заменить.
    const existing = await db.taskPhotos.where('taskId').equals(task.id).toArray();
    const have = new Set(existing.filter((r) => !r.deletedAt).map((r) => r.photoId));
    const wanted = new Set<string>();
    for (const p of photos) wanted.add(await photoIdOf(p));
    const same = wanted.size === have.size && [...wanted].every((id) => have.has(id));
    if (same) continue;

    await syncTaskPhotos(task.id, photos);
    done++;
  }
  return done;
}
