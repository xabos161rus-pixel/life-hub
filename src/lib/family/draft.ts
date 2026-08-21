// Черновик сообщения: недописанный текст и выбранная цитата.
//
// Экран чата размонтируется при уходе на «Участников», при переключении
// группы, при сворачивании приложения на телефоне. Набранный текст исчезал
// молча — а на телефоне это половина сообщения, которую надо набирать заново.
// Держим черновик рядом с группой и восстанавливаем при возвращении.
//
// Хранилище — localStorage, а не база: черновик привязан к устройству (на
// телефоне свой, на ноутбуке свой) и не должен ни синхронизироваться, ни
// шифроваться семейным ключом. Ничего чужого в нём нет.

const KEY = 'life-hub-chat-draft';

export type Draft = {
  text: string;
  /** clientMsgId сообщения, на которое отвечаем. */
  replyToId?: string;
};

type Store = Record<string, Draft>;

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
    /* приватный режим или переполнение — черновик не та вещь, ради которой
       стоит ронять отправку сообщения */
  }
}

export function loadDraft(familyId: string): Draft | null {
  return read()[familyId] ?? null;
}

/** Пустой черновик стирается: иначе он копился бы по группе на каждый
 *  случайно тронутый ввод. */
export function saveDraft(familyId: string, draft: Draft) {
  const store = read();
  if (!draft.text.trim() && !draft.replyToId) delete store[familyId];
  else store[familyId] = draft;
  write(store);
}

export function clearDraft(familyId: string) {
  const store = read();
  if (!(familyId in store)) return;
  delete store[familyId];
  write(store);
}
