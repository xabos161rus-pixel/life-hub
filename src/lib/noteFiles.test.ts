import { describe, expect, it } from 'vitest';
import type { NoteFile } from '../db/types';
import { groupNoteAttachments, planNoteFileChunks } from './noteFiles';
import { CHUNK_RAW_BYTES } from './family/fileTransfer';

const META = { name: 'отчёт.pdf', mime: 'application/pdf', size: 1234 };

function rows(chunks: ReturnType<typeof planNoteFileChunks>): NoteFile[] {
  return chunks.map((c, i) => ({
    ...c,
    id: `row-${i}`,
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
    deletedAt: null,
  }));
}

describe('вложения заметок: нарезка и сборка', () => {
  it('маленький файл — один чанк, собирается в исходный dataURL', () => {
    const dataUrl = 'data:application/pdf;base64,AAAA';
    const chunks = planNoteFileChunks('n1', 'f1', META, dataUrl);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ noteId: 'n1', fileId: 'f1', idx: 0, total: 1, ...META });
    const [att] = groupNoteAttachments(rows(chunks));
    expect(att.data).toBe(dataUrl);
    expect(att.name).toBe('отчёт.pdf');
  });

  it('большой файл режется по границе чанка и собирается без потерь', () => {
    const dataUrl = 'x'.repeat(CHUNK_RAW_BYTES * 2 + 5);
    const chunks = planNoteFileChunks('n1', 'f1', META, dataUrl);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((c) => c.total === 3)).toBe(true);
    // Порядок прихода не гарантирован (синк) — собираем из перемешанного.
    const [att] = groupNoteAttachments(rows(chunks).reverse());
    expect(att.data).toBe(dataUrl);
  });

  it('неполный файл (чанк ещё едет синком) — без data, но с метаданными', () => {
    const dataUrl = 'x'.repeat(CHUNK_RAW_BYTES + 1);
    const chunks = planNoteFileChunks('n1', 'f1', META, dataUrl);
    const partial = rows(chunks).slice(0, 1);
    const [att] = groupNoteAttachments(partial);
    expect(att.data).toBeUndefined();
    expect(att.size).toBe(1234);
  });

  it('мягко удалённые чанки не воскрешают вложение', () => {
    const chunks = rows(planNoteFileChunks('n1', 'f1', META, 'data:x,1'));
    const deleted = chunks.map((c) => ({ ...c, deletedAt: '2026-08-12T01:00:00.000Z' }));
    expect(groupNoteAttachments(deleted)).toHaveLength(0);
  });

  it('несколько файлов — по вложению на fileId, порядок стабильный', () => {
    const a = rows(planNoteFileChunks('n1', 'fa', { ...META, name: 'б.txt' }, 'data:x,a'));
    const b = rows(planNoteFileChunks('n1', 'fb', { ...META, name: 'а.txt' }, 'data:x,b'));
    const atts = groupNoteAttachments([...a, ...b]);
    expect(atts.map((x) => x.name)).toEqual(['а.txt', 'б.txt']);
  });

  it('пустой файл — один пустой чанк, собирается в пустую строку', () => {
    const chunks = planNoteFileChunks('n1', 'f1', { ...META, size: 0 }, '');
    expect(chunks).toHaveLength(1);
    const [att] = groupNoteAttachments(rows(chunks));
    expect(att.data).toBe('');
  });
});
