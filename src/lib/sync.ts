// Движок E2E-синхронизации: pull (получить чужие изменения, расшифровать,
// применить по принципу «новейший побеждает») + push (зашифровать свои свежие
// изменения и отправить). Содержимое шифруется на устройстве; на Worker уходит
// только шифротекст + служебные поля.

import { db } from '../db/db';
import type { SyncConfig } from '../db/types';
import {
  encryptJSON,
  decryptJSON,
  generateKey,
  exportKeyRaw,
  importKeyRaw,
  newAccountId,
  randomToken,
  encodePairing,
  decodePairing,
} from './crypto';
import { getSyncConfig, patchSyncConfig, saveSyncConfig, clearSyncConfig } from './syncState';

const WORKER_URL = 'https://life-hub-push.xabos161rus.workers.dev';
const PUSH_CHUNK = 200;

// Таблицы, которые синхронизируются. settings (device-local) и sync (секреты)
// сюда НЕ входят намеренно. Включены legacy habits/metrics (пустые) — безвредно.
const SYNCED_TABLES = [
  'projects',
  'tasks',
  'goals',
  'habits',
  'habitLogs',
  'notes',
  'learningItems',
  'learningLogs',
  'expenseItems',
  'savingsGoals',
  'savingsDeposits',
  'energyItems',
  'placeItems',
  'metrics',
  'metricLogs',
  'reminderSections',
  'reminderItems',
] as const;
type SyncedTable = (typeof SYNCED_TABLES)[number];
const isSynced = (t: string): t is SyncedTable => (SYNCED_TABLES as readonly string[]).includes(t);

interface RemoteRecord {
  table: string;
  id: string;
  updatedAt: string;
  deletedAt: string | null;
  ciphertext: string;
}

type Row = Record<string, unknown> & { id: string; updatedAt: string; deletedAt: string | null };

// Полезная нагрузка записи familyShare: семейное подключение, реплицируемое
// между устройствами ОДНОГО аккаунта. Ключ семьи — в сыром base64url виде,
// но только внутри шифротекста аккаунтного ключа.
interface FamilySharePayload {
  familyId: string;
  familyToken: string;
  keyRaw: string;
  familyName: string;
  selfMemberId: string;
  joinedAt: string;
  enabled: boolean;
  updatedAt: string;
}

/** Применять ли удалённую правку: если локальной нет или удалённая новее (LWW). */
export function shouldApply(localUpdatedAt: string | undefined, remoteUpdatedAt: string): boolean {
  return !localUpdatedAt || remoteUpdatedAt > localUpdatedAt;
}

function authHeaders(c: SyncConfig): Record<string, string> {
  return {
    'X-Account': c.accountId,
    Authorization: `Bearer ${c.authToken}`,
    'Content-Type': 'application/json',
  };
}

// === PULL ===
async function pullPage(
  c: SyncConfig,
  since: string,
): Promise<{ applied: number; nextSince: string; hasMore: boolean }> {
  const res = await fetch(`${WORKER_URL}/sync/pull?since=${encodeURIComponent(since)}`, {
    headers: authHeaders(c),
  });
  if (!res.ok) throw new Error(`pull ${res.status}`);
  const data = (await res.json()) as { records: RemoteRecord[]; hasMore: boolean; nextSince: string };
  let applied = 0;
  for (const r of data.records) {
    // Семейное подключение с другого МОЕГО устройства: восстанавливаем конфиг
    // (ключ/токен зашифрованы аккаунтным ключом). Курсоры чтения — свои,
    // с нуля: бэкфилл комнаты доберёт историю. FamilyRunner увидит новую
    // группу через liveQuery и сам поднимет соединение.
    if (r.table === 'familyShare') {
      const p = await decryptJSON<FamilySharePayload>(c.key, r.ciphertext);
      const local = await db.family.get(p.familyId);
      if (!local) {
        await db.family.put({
          id: p.familyId,
          familyId: p.familyId,
          familyToken: p.familyToken,
          familyKey: await importKeyRaw(p.keyRaw),
          familyName: p.familyName,
          selfMemberId: p.selfMemberId,
          lastSeq: 0,
          lastReadSeq: 0,
          enabled: p.enabled,
          joinedAt: p.joinedAt,
          updatedAt: p.updatedAt,
        });
        applied++;
      } else if (shouldApply(local.updatedAt, p.updatedAt)) {
        await db.family.update(p.familyId, {
          familyToken: p.familyToken,
          familyName: p.familyName,
          enabled: p.enabled,
          updatedAt: p.updatedAt,
        });
        applied++;
      }
      continue;
    }
    if (!isSynced(r.table)) continue; // незнакомая таблица — пропускаем
    const table = db.table<Row>(r.table);
    const local = await table.get(r.id);
    if (!shouldApply(local?.updatedAt, r.updatedAt)) continue;
    const obj = await decryptJSON<Row>(c.key, r.ciphertext);
    // Пишем НАПРЯМУЮ (минуя repo) — сохраняем серверный updatedAt, иначе синк
    // зациклится (repo проставил бы новый updatedAt → бесконечный пинг-понг).
    await table.put(obj);
    applied++;
  }
  return { applied, nextSince: data.nextSince, hasMore: data.hasMore };
}

async function pull(c: SyncConfig): Promise<number> {
  let total = 0;
  let since = c.lastPullAt;
  for (;;) {
    const { applied, nextSince, hasMore } = await pullPage(c, since);
    total += applied;
    since = nextSince;
    if (!hasMore) break;
  }
  await patchSyncConfig({ lastPullAt: since });
  return total;
}

// === PUSH ===
// Полный скан таблиц + фильтр по updatedAt > курсора. Для личного объёма данных
// (сотни записей) это миллисекунды; при росте можно перейти на outbox/индекс.
async function push(c: SyncConfig): Promise<number> {
  let maxUpdatedAt = c.lastPushAt;
  const fresh: { name: string; row: Row }[] = [];
  for (const name of SYNCED_TABLES) {
    const rows = (await db.table<Row>(name).toArray()).filter(
      (r) => typeof r.updatedAt === 'string' && r.updatedAt > c.lastPushAt,
    );
    for (const row of rows) {
      fresh.push({ name, row });
      if (row.updatedAt > maxUpdatedAt) maxUpdatedAt = row.updatedAt;
    }
  }
  // Шифруем параллельно (Promise.all), а не последовательно await в цикле —
  // не блокирует main-thread при правке задачи с большим набором изменений.
  const out: RemoteRecord[] = await Promise.all(
    fresh.map(async ({ name, row }) => ({
      table: name,
      id: row.id,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt ?? null,
      ciphertext: await encryptJSON(c.key, row),
    })),
  );
  // Семейные подключения — на другие МОИ устройства (ключ семьи внутри
  // шифротекста аккаунтного ключа; серверу, как и всё остальное, не виден).
  const famFresh = (await db.family.toArray()).filter(
    (f) => typeof f.updatedAt === 'string' && f.updatedAt > c.lastPushAt,
  );
  for (const f of famFresh) {
    const payload: FamilySharePayload = {
      familyId: f.familyId,
      familyToken: f.familyToken,
      keyRaw: await exportKeyRaw(f.familyKey),
      familyName: f.familyName,
      selfMemberId: f.selfMemberId,
      joinedAt: f.joinedAt,
      enabled: f.enabled,
      updatedAt: f.updatedAt!,
    };
    out.push({
      table: 'familyShare',
      id: f.familyId,
      updatedAt: f.updatedAt!,
      deletedAt: null,
      ciphertext: await encryptJSON(c.key, payload),
    });
    if (f.updatedAt! > maxUpdatedAt) maxUpdatedAt = f.updatedAt!;
  }
  for (let i = 0; i < out.length; i += PUSH_CHUNK) {
    const res = await fetch(`${WORKER_URL}/sync/push`, {
      method: 'POST',
      headers: authHeaders(c),
      body: JSON.stringify({ records: out.slice(i, i + PUSH_CHUNK) }),
    });
    if (!res.ok) throw new Error(`push ${res.status}`);
  }
  await patchSyncConfig({ lastPushAt: maxUpdatedAt });
  return out.length;
}

// === Оркестрация ===
let running = false;
let lastError: string | null = null;

/** Один цикл: pull → push. Возвращает null, если синк выключен или уже идёт. */
export async function runSync(): Promise<{ pulled: number; pushed: number } | null> {
  if (running) return null;
  const c = await getSyncConfig();
  if (!c || !c.enabled) return null;
  running = true;
  lastError = null;
  try {
    const pulled = await pull(c);
    const fresh = await getSyncConfig(); // курсор pull обновился
    const pushed = fresh ? await push(fresh) : 0;
    await patchSyncConfig({ lastSyncedAt: new Date().toISOString() });
    return { pulled, pushed };
  } catch (e) {
    lastError = String(e);
    throw e;
  } finally {
    running = false;
  }
}

export function syncRunning(): boolean {
  return running;
}

export function lastSyncError(): string | null {
  return lastError;
}

// Debounce-синк после правок: любая локальная запись через repo дёргает это,
// пачка изменений за DEBOUNCE_MS уходит одним синком. runSync сам выходит,
// если синк выключен, поэтому накладных для не-настроенных пользователей нет.
const DEBOUNCE_MS = 1500;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleSyncSoon(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void runSync().catch(() => {});
  }, DEBOUNCE_MS);
}

// === Жизненный цикл сопряжения ===

/** Создать новый аккаунт синхронизации на этом устройстве (первое устройство). */
export async function createSyncAccount(): Promise<void> {
  const key = await generateKey();
  await saveSyncConfig({
    id: 'config',
    accountId: newAccountId(),
    authToken: randomToken(),
    key,
    enabled: true,
    lastPullAt: '',
    lastPushAt: '',
    lastSyncedAt: '',
  });
}

/** Подключить это устройство к существующему аккаунту по пакету сопряжения. */
export async function connectSync(code: string): Promise<void> {
  const p = decodePairing(code);
  const key = await importKeyRaw(p.key);
  await saveSyncConfig({
    id: 'config',
    accountId: p.accountId,
    authToken: p.authToken,
    key,
    enabled: true,
    lastPullAt: '',
    lastPushAt: '',
    lastSyncedAt: '',
  });
}

/** Код сопряжения для переноса на другое устройство (QR / резервная копия). */
export async function getPairingCode(): Promise<string | null> {
  const c = await getSyncConfig();
  if (!c) return null;
  return encodePairing({ v: 1, accountId: c.accountId, authToken: c.authToken, key: await exportKeyRaw(c.key) });
}

/** Полностью отключить синхронизацию на этом устройстве (локальные данные целы). */
export async function disableSync(): Promise<void> {
  await clearSyncConfig();
}
