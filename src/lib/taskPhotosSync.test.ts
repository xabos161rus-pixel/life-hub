// Двойная запись снимков: куски идут рядом со строкой задачи.

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { assemblePhotos, migrateTaskPhotos, photoIdOf, syncTaskPhotos } from './taskPhotos';

const photo = (mark: string) => 'data:image/jpeg;base64,' + mark.repeat(600);

async function chunksOf(taskId: string) {
  return (await db.taskPhotos.where('taskId').equals(taskId).toArray()).filter((r) => !r.deletedAt);
}

describe('двойная запись фотографий задачи', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('снимки задачи раскладываются кусками и собираются обратно', async () => {
    const a = photo('A');
    const b = photo('B');
    await syncTaskPhotos('t1', [a, b]);

    expect(assemblePhotos(await chunksOf('t1')).sort()).toEqual([a, b].sort());
  });

  it('повторный вызов ничего не дублирует', async () => {
    // Перекладывать старые задачи будут оба устройства независимо, и запуск
    // после обрыва повторится. Дубли уехали бы на сервер и остались там.
    const a = photo('A');
    await syncTaskPhotos('t1', [a]);
    const first = (await chunksOf('t1')).map((r) => r.id).sort();
    await syncTaskPhotos('t1', [a]);
    expect((await chunksOf('t1')).map((r) => r.id).sort()).toEqual(first);
  });

  it('удалённый снимок исчезает и из кусков', async () => {
    const a = photo('A');
    const b = photo('B');
    await syncTaskPhotos('t1', [a, b]);
    await syncTaskPhotos('t1', [a]); // второй снимок убрали в форме

    expect(assemblePhotos(await chunksOf('t1'))).toEqual([a]);
  });

  it('добавление и удаление в одной правке разбираются по составу, а не по счёту', async () => {
    // Ровно тот случай, на котором ломается сравнение по длине: снимков было
    // два и осталось два, но это ДРУГИЕ два.
    const a = photo('A');
    const b = photo('B');
    const c = photo('C');
    await syncTaskPhotos('t1', [a, b]);
    await syncTaskPhotos('t1', [a, c]);

    expect(assemblePhotos(await chunksOf('t1')).sort()).toEqual([a, c].sort());
  });

  it('строку задачи не трогает — фоновое перекладывание не должно выглядеть как правка', async () => {
    const ts = '2026-08-01T10:00:00.000Z';
    await db.tasks.put({
      id: 't1', title: 'Товар', photos: [photo('A')],
      createdAt: ts, updatedAt: ts, deletedAt: null,
    } as never);

    await syncTaskPhotos('t1', [photo('A')]);

    // Время правки задачи прежнее: иначе перекладывание затёрло бы на сервере
    // изменения, которые второе устройство ещё не забрало.
    expect((await db.tasks.get('t1'))?.updatedAt).toBe(ts);
  });

  it('снимки разных задач не смешиваются', async () => {
    const a = photo('A');
    await syncTaskPhotos('t1', [a]);
    await syncTaskPhotos('t2', [photo('B')]);

    expect(assemblePhotos(await chunksOf('t1'))).toEqual([a]);
    expect((await chunksOf('t2')).every((r) => r.taskId === 't2')).toBe(true);
  });

  it('id куска не зависит от задачи-владельца — одинаковый снимок не режется дважды по-разному', async () => {
    const a = photo('A');
    const id = await photoIdOf(a);
    await syncTaskPhotos('t1', [a]);
    expect((await chunksOf('t1'))[0].id.startsWith(id)).toBe(true);
  });
});

describe('перекладывание старых задач', () => {
  beforeEach(async () => {
    await db.open();
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  const seedTask = async (id: string, photos: string[]) => {
    const ts = '2026-08-01T10:00:00.000Z';
    await db.tasks.put({
      id, title: `Задача ${id}`, photos,
      createdAt: ts, updatedAt: ts, deletedAt: null,
    } as never);
  };

  it('раскладывает снимки задач, у которых их ещё нет', async () => {
    await seedTask('t1', [photo('A')]);
    await seedTask('t2', [photo('B')]);

    const moved = await migrateTaskPhotos(10);

    expect(moved).toBe(2);
    expect(assemblePhotos(await chunksOf('t1'))).toEqual([photo('A')]);
    expect(assemblePhotos(await chunksOf('t2'))).toEqual([photo('B')]);
  });

  it('второй заход не делает лишней работы', async () => {
    await seedTask('t1', [photo('A')]);
    await migrateTaskPhotos(10);
    expect(await migrateTaskPhotos(10)).toBe(0);
  });

  it('идёт порциями — фоновая работа не занимает поток целиком', async () => {
    for (const m of ['A', 'B', 'C', 'D']) await seedTask(`t${m}`, [photo(m)]);
    expect(await migrateTaskPhotos(2)).toBe(2);
    expect(await migrateTaskPhotos(2)).toBe(2);
    expect(await migrateTaskPhotos(2)).toBe(0);
  });

  it('задачи без снимков и удалённые не трогает', async () => {
    await seedTask('empty', []);
    const ts = '2026-08-01T10:00:00.000Z';
    await db.tasks.put({
      id: 'dead', title: 'В корзине', photos: [photo('A')],
      createdAt: ts, updatedAt: ts, deletedAt: ts,
    } as never);

    expect(await migrateTaskPhotos(10)).toBe(0);
  });

  it('строки задач остаются нетронутыми', async () => {
    const ts = '2026-08-01T10:00:00.000Z';
    await seedTask('t1', [photo('A')]);
    await migrateTaskPhotos(10);

    const task = await db.tasks.get('t1');
    // Ни время правки, ни сами снимки в строке не изменились: пока второе
    // устройство может быть на старой версии, поле photos обязано остаться.
    expect(task?.updatedAt).toBe(ts);
    expect(task?.photos).toEqual([photo('A')]);
  });
});
