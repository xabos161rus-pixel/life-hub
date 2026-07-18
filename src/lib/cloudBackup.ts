// Облачная резервная копия аккаунта (E2E). Полный снапшот всех данных
// (шире дельта-синка: включает семейный чат/задачи) шифруется аккаунтным
// ключом НА устройстве и кладётся на Worker. Сервер видит только шифротекст.
// Модель latest-only: одна копия на аккаунт, при необходимости — чанками.

import { exportBackup, validateBackup, type BackupFile } from '../db/backup';
import { encryptJSON, decryptJSON } from './crypto';
import { getSyncConfig } from './syncState';
import type { SyncConfig } from '../db/types';

const WORKER_URL = 'https://life-hub-push.xabos161rus.workers.dev';

// Порог чанка по plaintext-байтам. D1: значение одной колонки ≤ 2 МБ, а
// base64url-шифротекст раздувает объём ~на треть — держим консервативно.
const CHUNK_BYTES = 1_000_000;

function authHeaders(c: SyncConfig): Record<string, string> {
  return {
    'X-Account': c.accountId,
    Authorization: `Bearer ${c.authToken}`,
    'Content-Type': 'application/json',
  };
}

/** Режем строку на куски ≤ maxBytes в UTF-8, не разрывая code point. */
function chunkByBytes(s: string, maxBytes: number): string[] {
  const bytes = new TextEncoder().encode(s);
  const dec = new TextDecoder();
  const out: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(bytes.length, start + maxBytes);
    // 0x80–0xBF — continuation-байт: отступаем к началу code point.
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(dec.decode(bytes.subarray(start, end)));
    start = end;
  }
  return out;
}

/** Загрузить зашифрованный снапшот аккаунта в облако. Возвращает число чанков
 *  (0 — если синхронизация не включена: без аккаунтного ключа копии нет). */
export async function pushAccountSnapshot(): Promise<number> {
  const c = await getSyncConfig();
  if (!c?.enabled) return 0;
  const snapshot = await exportBackup();
  const parts = chunkByBytes(JSON.stringify(snapshot), CHUNK_BYTES);
  const chunks = await Promise.all(
    parts.map(async (p, i) => ({ chunk: i, ciphertext: await encryptJSON(c.key, p) })),
  );
  const res = await fetch(`${WORKER_URL}/backup/put`, {
    method: 'POST',
    headers: authHeaders(c),
    body: JSON.stringify({ chunks, total: chunks.length }),
  });
  if (!res.ok) throw new Error(`backup put ${res.status}`);
  return chunks.length;
}

/** Скачать и расшифровать облачную копию. null — копии нет / синк выключен. */
export async function pullAccountSnapshot(): Promise<BackupFile | null> {
  const c = await getSyncConfig();
  if (!c?.enabled) return null;
  const res = await fetch(`${WORKER_URL}/backup/get`, { headers: authHeaders(c) });
  if (!res.ok) throw new Error(`backup get ${res.status}`);
  const data = (await res.json()) as {
    chunks: { chunk: number; ciphertext: string }[];
    updatedAt: string | null;
  };
  if (!data.chunks?.length) return null;
  const ordered = [...data.chunks].sort((a, b) => a.chunk - b.chunk);
  let s = '';
  for (const ch of ordered) s += await decryptJSON<string>(c.key, ch.ciphertext);
  return validateBackup(JSON.parse(s));
}
