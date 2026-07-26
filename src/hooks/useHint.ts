import { useSyncExternalStore } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { updateSettings } from './useSettings';

/** Подсказки, скрытые «только сейчас».
 *
 *  Живут в памяти модуля, а не в хранилище. sessionStorage не подходит: он
 *  переживает перезагрузку страницы, а обещание — «до перезагрузки». Обычный
 *  Set умирает ровно тогда, когда обещано.
 *
 *  Честная оговорка: в установленном приложении возврат из фона перезагрузкой
 *  не считается — подсказка останется скрытой, пока приложение не выгрузят из
 *  памяти. Это и есть ожидаемое поведение: человек просил спрятать на время
 *  работы, а не на пять минут. */
const hiddenThisSession = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Снимок для useSyncExternalStore. Возвращает строку, а не Set: React
 *  сравнивает снимки по ссылке, и новый Set на каждый вызов означал бы
 *  бесконечную перерисовку. */
function snapshot(): string {
  return [...hiddenThisSession].sort().join(',');
}

/** Вернуть на экран всё, что скрыто «только сейчас». Зовётся из настроек. */
export function resetSessionHints(): void {
  if (hiddenThisSession.size === 0) return;
  hiddenThisSession.clear();
  emit();
}

/** Пометить подсказку показанной. Читаем актуальный список из БД (а не из
 *  замыкания) — параллельное скрытие двух подсказок не потеряет ни одну. */
async function markHintSeen(id: string): Promise<void> {
  const s = await db.settings.get('app');
  const seen = s?.seenHints ?? [];
  if (!seen.includes(id)) await updateSettings({ seenHints: [...seen, id] });
}

/** Все подсказки приложения.
 *
 *  Список нужен ровно для одного: показать в настройках «скрыто 3 из 5».
 *  Считать по факту неоткуда — подсказка существует только когда отрисован её
 *  экран. Цена: добавив новую подсказку, надо дописать её сюда, иначе счётчик
 *  соврёт. Тест держит список в соответствии с кодом. */
export const HINT_IDS = [
  'tasks-quick-add',
  'tasks-gestures',
  'task-notes-tricks',
  'chat-gestures',
  'note-editor-tricks',
] as const;

/** Как человек закрыл подсказку. */
export type DismissScope = 'forever' | 'session';

/**
 * Одноразовая контекстная подсказка. Появляется только после вводного тура —
 * чтобы не наслаивать обучение на обучение.
 *
 * Закрыть можно двумя способами: навсегда (пишется в settings.seenHints) или
 * до перезагрузки (держится в памяти). Второй вариант нужен тем, кто подсказку
 * ещё не прочитал, но кому она мешает прямо сейчас: раньше выбор был между
 * «убрать навсегда» и «терпеть».
 */
export function useHint(id: string): {
  visible: boolean;
  dismiss: (scope: DismissScope) => void;
} {
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const hiddenNow = useSyncExternalStore(subscribe, snapshot, () => '');

  const visible =
    settings !== undefined &&
    Boolean(settings?.onboardingDone) &&
    !(settings?.seenHints ?? []).includes(id) &&
    !hiddenNow.split(',').includes(id);

  return {
    visible,
    dismiss: (scope: DismissScope) => {
      if (scope === 'forever') {
        void markHintSeen(id);
        return;
      }
      hiddenThisSession.add(id);
      emit();
    },
  };
}
