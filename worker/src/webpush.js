// Web Push на чистом WebCrypto: шифрование aes128gcm (RFC 8291 + RFC 8188) и
// VAPID-подпись ES256 (RFC 8292). Работает в Cloudflare Workers (crypto глобален).
// Apple Web Push (iOS 16.4+) требует именно aes128gcm — старый aesgcm не подходит.

const enc = new TextEncoder();

export function b64urlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToB64url(bytes) {
  const b = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

// HKDF (extract+expand) через WebCrypto deriveBits.
async function hkdf(salt, ikm, info, lengthBytes) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info },
    key,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}

/** aes128gcm-шифрование payload (Uint8Array) для подписки. Опц. salt/asKeys —
 *  для воспроизводимой проверки по тест-вектору; в проде генерируются случайно. */
export async function encryptPayload(payload, uaPublicB64, authB64, opts = {}) {
  const uaPublic = b64urlToBytes(uaPublicB64); // 65 байт (несжатая точка P-256)
  const authSecret = b64urlToBytes(authB64); // 16 байт

  const asKeys =
    opts.asKeys ??
    (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']));
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey)); // 65

  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256),
  ); // 32

  // IKM (RFC 8291 §3.4): info = "WebPush: info\0" || ua_public || as_public
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // CEK + NONCE (RFC 8188 §2.2)
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  // единственный (последний) record → разделитель 0x02, без доп. паддинга
  const plaintext = concat(payload, new Uint8Array([0x02]));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, plaintext),
  );

  // фрейминг (RFC 8188 §2.1): salt(16) | rs(4 BE) | idlen(1) | keyid(as_public) | ciphertext
  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096, false);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

/** VAPID Authorization-заголовок (RFC 8292): "vapid t=<JWT ES256>, k=<public>". */
export async function vapidAuthHeader(endpoint, vapidPublicB64, vapidPrivatePkcs8B64, subject) {
  const origin = new URL(endpoint).origin;
  const header = bytesToB64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  const payload = bytesToB64url(enc.encode(JSON.stringify({ aud: origin, exp, sub: subject })));
  const signingInput = `${header}.${payload}`;

  const pk = await crypto.subtle.importKey(
    'pkcs8',
    b64urlToBytes(vapidPrivatePkcs8B64),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, pk, enc.encode(signingInput));
  return `vapid t=${signingInput}.${bytesToB64url(sig)}, k=${vapidPublicB64}`;
}

/** Готовый запрос пуша: endpoint + headers + зашифрованное тело. */
export async function buildPushRequest({ subscription, payload, vapid, ttl = 3600, urgency = 'high' }) {
  const body = await encryptPayload(
    enc.encode(payload),
    subscription.keys.p256dh,
    subscription.keys.auth,
  );
  const Authorization = await vapidAuthHeader(
    subscription.endpoint,
    vapid.publicKey,
    vapid.privateKey,
    vapid.subject,
  );
  return {
    endpoint: subscription.endpoint,
    headers: {
      Authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  };
}
