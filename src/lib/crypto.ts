// E2E-крипто для облачной синхронизации (Фаза 0).
// Содержимое записей шифруется НА устройстве (AES-256-GCM) перед отправкой;
// ключ никогда не уходит на сервер. На сервере лежит только шифротекст +
// открытые служебные поля (id/updatedAt/deletedAt) для дельта-синка.
// Чистый WebCrypto, без зависимостей — работает и в браузере, и в Node 20+.

// === base64url (без паддинга) ↔ байты; одинаково в браузере и Node ===
function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const IV_BYTES = 12; // рекомендованный размер nonce для AES-GCM

// === Ключ шифрования (AES-256-GCM) ===
export function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

export async function exportKeyRaw(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bytesToB64url(new Uint8Array(raw));
}

export function importKeyRaw(b64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', b64urlToBytes(b64), { name: 'AES-GCM' }, true, [
    'encrypt',
    'decrypt',
  ]);
}

// === Шифрование полезной нагрузки записи ===
// Формат шифротекста: base64url( iv(12 байт) ‖ ciphertext ).
export async function encryptJSON(key: CryptoKey, obj: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const ctBytes = new Uint8Array(ct);
  const combined = new Uint8Array(iv.length + ctBytes.length);
  combined.set(iv, 0);
  combined.set(ctBytes, iv.length);
  return bytesToB64url(combined);
}

export async function decryptJSON<T>(key: CryptoKey, payload: string): Promise<T> {
  const combined = b64urlToBytes(payload);
  const iv = combined.slice(0, IV_BYTES);
  const ct = combined.slice(IV_BYTES);
  const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(data)) as T;
}

// === Идентификаторы аккаунта (на сервер уходят, ключ — нет) ===
/** id «строки» данных на сервере — какому набору принадлежат записи. */
export function newAccountId(): string {
  return crypto.randomUUID();
}

/** случайный bearer-токен для авторизации запросов к Worker. */
export function randomToken(bytes = 32): string {
  return bytesToB64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

// === Пакет сопряжения (переносится между устройствами через QR / строку) ===
// Содержит всё нужное второму устройству: id аккаунта, токен доступа и ключ.
// Ключ внутри пакета — поэтому пакет так же секретен, как сам ключ.
export interface PairingData {
  v: 1;
  accountId: string;
  authToken: string;
  key: string; // raw-ключ в base64url
}

export function encodePairing(d: PairingData): string {
  return bytesToB64url(new TextEncoder().encode(JSON.stringify(d)));
}

export function decodePairing(code: string): PairingData {
  const json = new TextDecoder().decode(b64urlToBytes(code.trim()));
  const d = JSON.parse(json) as PairingData;
  if (d.v !== 1 || !d.accountId || !d.authToken || !d.key) {
    throw new Error('Некорректный код сопряжения');
  }
  return d;
}

// === Пакет приглашения в СЕМЬЮ (v:2) ===
// Отдельный формат от device-сопряжения (v:1): шарится между людьми, содержит
// общий семейный ключ + имя семьи. Тот же AES-256-GCM ключ под капотом.
export interface FamilyPairingData {
  v: 2;
  familyId: string;
  familyToken: string;
  key: string; // общий семейный raw-ключ в base64url
  familyName: string;
}

export function encodeFamilyPairing(d: FamilyPairingData): string {
  return bytesToB64url(new TextEncoder().encode(JSON.stringify(d)));
}

export function decodeFamilyPairing(code: string): FamilyPairingData {
  const json = new TextDecoder().decode(b64urlToBytes(code.trim()));
  const d = JSON.parse(json) as FamilyPairingData;
  if (d.v !== 2 || !d.familyId || !d.familyToken || !d.key) {
    throw new Error('Некорректный код приглашения в семью');
  }
  return d;
}
