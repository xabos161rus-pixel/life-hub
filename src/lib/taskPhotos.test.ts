// Куски фотографий задач: как режутся и как собираются обратно.

import { describe, expect, it } from 'vitest';
import { assemblePhotos, photoIdOf, planPhotoChunks } from './taskPhotos';
import type { TaskPhoto } from '../db/types';

const rows = (
  chunks: Array<{ id: string; row: Omit<TaskPhoto, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'> }>,
): TaskPhoto[] =>
  chunks.map((c) => ({
    ...c.row,
    id: c.id,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    deletedAt: null,
  }));

describe('фотографии задач кусками', () => {
  it('снимок собирается обратно байт в байт', async () => {
    const photo = 'data:image/jpeg;base64,' + 'A'.repeat(900_000);
    const id = await photoIdOf(photo);
    const chunks = planPhotoChunks('t1', id, photo);

    expect(chunks.length).toBeGreaterThan(1);
    expect(assemblePhotos(rows(chunks))).toEqual([photo]);
  });

  it('id кусков считается из содержимого — два устройства придут к одному', async () => {
    // Старые задачи перекладывают оба устройства независимо. Со случайными
    // идентификаторами вышло бы два комплекта одних и тех же снимков.
    const photo = 'data:image/jpeg;base64,' + 'B'.repeat(1000);
    const mac = planPhotoChunks('t1', await photoIdOf(photo), photo);
    const phone = planPhotoChunks('t1', await photoIdOf(photo), photo);
    expect(mac.map((c) => c.id)).toEqual(phone.map((c) => c.id));
  });

  it('разные снимки не сливаются', async () => {
    const a = 'data:image/jpeg;base64,' + 'A'.repeat(500);
    const b = 'data:image/jpeg;base64,' + 'B'.repeat(500);
    const chunks = [
      ...planPhotoChunks('t1', await photoIdOf(a), a),
      ...planPhotoChunks('t1', await photoIdOf(b), b),
    ];
    expect(assemblePhotos(rows(chunks)).sort()).toEqual([a, b].sort());
  });

  it('снимок с недоехавшим куском пропускается, а не показывается битым', async () => {
    const photo = 'data:image/jpeg;base64,' + 'A'.repeat(900_000);
    const chunks = planPhotoChunks('t1', await photoIdOf(photo), photo);
    // Один кусок ещё едет синком.
    expect(assemblePhotos(rows(chunks.slice(1)))).toEqual([]);
  });

  it('удалённые куски не участвуют', async () => {
    const photo = 'data:image/jpeg;base64,' + 'A'.repeat(500);
    const all = rows(planPhotoChunks('t1', await photoIdOf(photo), photo));
    const dead = all.map((r) => ({ ...r, deletedAt: '2026-08-22T00:00:00.000Z' }));
    expect(assemblePhotos(dead)).toEqual([]);
  });

  it('порядок снимков одинаков на обоих устройствах', async () => {
    const a = 'data:image/jpeg;base64,' + 'A'.repeat(500);
    const b = 'data:image/jpeg;base64,' + 'B'.repeat(500);
    const mk = async () => [
      ...planPhotoChunks('t1', await photoIdOf(a), a),
      ...planPhotoChunks('t1', await photoIdOf(b), b),
    ];
    const first = assemblePhotos(rows(await mk()));
    // Второе устройство получило куски в другом порядке — синк порядок не хранит.
    const shuffled = rows(await mk()).reverse();
    expect(assemblePhotos(shuffled)).toEqual(first);
  });
});
