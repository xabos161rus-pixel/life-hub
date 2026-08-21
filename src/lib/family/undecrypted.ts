// Сообщения, которые не удалось прочитать.
//
// Такое случается, когда ключ группы сменили (кого-то исключили), а конверт
// с новым до этого устройства не дошёл. Приложение сначала пробует забрать
// свой ключ с сервера; если и это не помогло, сообщения остаются нечитаемыми.
//
// Раньше они просто исчезали: в переписке оставалась дыра, и человек даже не
// знал, что что-то приходило. Считаем их и показываем строкой в чате —
// молчаливая потеря хуже честного «прочитать не удалось».
//
// Хранилище — localStorage: счётчик привязан к устройству (на телефоне ключ
// может быть свежим, а на ноутбуке старым) и не должен ни синхронизироваться,
// ни переживать переустановку.

const KEY = 'life-hub-undecrypted';

type Store = Record<string, number>;
const subs = new Set<() => void>();

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store) {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* приватный режим: счётчик — не та вещь, ради которой стоит падать */
  }
  for (const cb of subs) cb();
}

/** Прибавить к счётчику группы. Ноль ничего не меняет — вызывается на каждой
 *  пачке сообщений, и лишняя запись будила бы подписчиков впустую. */
export function noteUndecrypted(familyId: string, count: number) {
  if (count <= 0) return;
  const store = read();
  store[familyId] = (store[familyId] ?? 0) + count;
  write(store);
}

export function undecryptedCount(familyId: string): number {
  return read()[familyId] ?? 0;
}

/** Сбросить счётчик: человек увидел предупреждение и закрыл его. */
export function clearUndecrypted(familyId: string) {
  const store = read();
  if (!(familyId in store)) return;
  delete store[familyId];
  write(store);
}

export function subscribeUndecrypted(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
