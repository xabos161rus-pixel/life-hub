// Клиент Web Push: запрос разрешения, подписка, постановка/снятие напоминаний
// на Worker. Реальные пуши приходят только в установленном PWA на iOS 16.4+.

import type { Task } from '../db/types';

const WORKER_URL = 'https://life-hub-push.xabos161rus.workers.dev';
// Публичный VAPID-ключ (пара к секрету воркера). Безопасно держать в коде.
const VAPID_PUBLIC =
  'BCi0yalmrjjC4elVs1vwAzGASoESrlpDA5ImcuB-u6kOVQf00Zc-GIK79WIBe7sQp5Y3_IBD96l8JEpccCj9Ws8';
const SUB_KEY = 'life-hub-push-sub';

type ReminderTask = Pick<Task, 'id' | 'title' | 'dueDate' | 'dueTime' | 'remindBefore'>;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function pushSupported(): boolean {
  return (
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  );
}

/** true — стоит в режиме приложения (иначе на iOS пуши не работают). */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

export function pushEnabled(): boolean {
  return (
    pushSupported() && Notification.permission === 'granted' && !!localStorage.getItem(SUB_KEY)
  );
}

function storedSub(): unknown | null {
  const raw = localStorage.getItem(SUB_KEY);
  return raw ? (JSON.parse(raw) as unknown) : null;
}

/** Запрос разрешения + подписка. Возвращает причину отказа для UI. */
export async function enablePush(): Promise<{ ok: boolean; reason?: string }> {
  if (!pushSupported()) return { ok: false, reason: 'unsupported' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: 'denied' };
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as BufferSource,
      });
    }
    localStorage.setItem(SUB_KEY, JSON.stringify(sub));
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e) };
  }
}

/** Абсолютное время срабатывания (epoch ms) или null, если задача не годится. */
function fireAtFor(t: ReminderTask): number | null {
  if (!t.dueDate || !t.dueTime || t.remindBefore == null) return null;
  // Локальный разбор: 'YYYY-MM-DDTHH:mm:00' трактуется как местное время.
  const start = new Date(`${t.dueDate}T${t.dueTime}:00`).getTime();
  if (Number.isNaN(start)) return null;
  return start - t.remindBefore * 60_000;
}

/** Ставит/обновляет напоминание задачи на Worker (или снимает, если не годится). */
export async function scheduleReminder(t: ReminderTask): Promise<void> {
  if (!storedSub()) return; // пуши не включены — нечего ставить
  const fireAt = fireAtFor(t);
  if (fireAt == null || fireAt < Date.now()) {
    await cancelReminder(t.id);
    return;
  }
  const body =
    t.remindBefore && t.remindBefore > 0 ? `через ${t.remindBefore} мин · в ${t.dueTime}` : `в ${t.dueTime}`;
  try {
    await fetch(`${WORKER_URL}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: t.id, fireAt, title: t.title, body, subscription: storedSub() }),
    });
  } catch {
    /* офлайн — переедет при следующем сохранении */
  }
}

export async function cancelReminder(taskId: string): Promise<void> {
  if (!storedSub()) return;
  try {
    await fetch(`${WORKER_URL}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });
  } catch {
    /* офлайн */
  }
}

/** Поставить пуш по произвольному id на абсолютное время (не задача — напр. помодоро). */
export async function schedulePush(
  id: string,
  fireAt: number,
  title: string,
  body: string,
): Promise<void> {
  if (!storedSub() || fireAt <= Date.now()) return;
  try {
    await fetch(`${WORKER_URL}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ taskId: id, fireAt, title, body, subscription: storedSub() }),
    });
  } catch {
    /* офлайн */
  }
}

/** Снять пуш по произвольному id. */
export async function cancelPush(id: string): Promise<void> {
  return cancelReminder(id);
}

/** После включения пушей — переставить напоминания всех будущих задач. */
export async function rescheduleAll(tasks: ReminderTask[]): Promise<void> {
  for (const t of tasks) {
    if (t.remindBefore != null) await scheduleReminder(t);
  }
}
