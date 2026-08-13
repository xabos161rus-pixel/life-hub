import { getLang, t } from './i18n';

// Состояние локального хранилища.
//
// Всё приложение живёт в IndexedDB на устройстве, и браузер имеет право её
// вычистить. Safari удаляет данные сайта после семи дней без визитов — если
// приложение открыто как вкладка, а не установлено на домашний экран. Chrome и
// Firefox чистят при нехватке места, начиная с сайтов без флага «постоянное».
//
// navigator.storage.persist() просит этот флаг. Просьбу можно и отклонить, и
// раньше приложение просто не замечало отказа: вызов стоял в main.tsx, его
// результат никуда не шёл, и человек узнавал бы о проблеме в тот день, когда
// открыл приложение и увидел пустой список.

export interface StorageState {
  /** Браузер обещал не вычищать данные. undefined — API не поддерживается. */
  persisted?: boolean;
  /** Занято байт (оценка браузера). */
  usage?: number;
  /** Доступно байт (оценка браузера). */
  quota?: number;
}

/** Просит постоянное хранилище и возвращает, что получилось.
 *
 *  Идемпотентна: если флаг уже выдан, повторный запрос не показывает
 *  пользователю никаких диалогов и просто возвращает true. */
export async function ensurePersistentStorage(): Promise<StorageState> {
  if (!navigator.storage) return {};

  let persisted: boolean | undefined;
  try {
    persisted = await navigator.storage.persisted?.();
    // Просим только если ещё не выдано: лишний вызов в некоторых браузерах
    // показывает запрос разрешения, а дёргать его на каждом запуске — плохо.
    if (persisted === false && navigator.storage.persist) {
      persisted = await navigator.storage.persist();
    }
  } catch {
    persisted = undefined;
  }

  let usage: number | undefined;
  let quota: number | undefined;
  try {
    const est = await navigator.storage.estimate?.();
    usage = est?.usage;
    quota = est?.quota;
  } catch {
    /* оценка недоступна — не беда */
  }

  return { persisted, usage, quota };
}

/** «12,4 МБ» — для строки о занятом месте. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} ${t('Б')}`;
  const units = ['КБ', 'МБ', 'ГБ'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const num = v.toFixed(v >= 10 ? 0 : 1);
  // Десятичный разделитель следует за языком: 12,4 по-русски, 12.4 по-английски.
  return `${getLang() === 'en' ? num : num.replace('.', ',')} ${t(units[i])}`;
}
