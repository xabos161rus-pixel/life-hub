import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { updateSettings } from './useSettings';

/** Пометить подсказку показанной. Читаем актуальный список из БД (а не из
 *  замыкания) — параллельное скрытие двух подсказок не потеряет ни одну. */
async function markHintSeen(id: string): Promise<void> {
  const s = await db.settings.get('app');
  const seen = s?.seenHints ?? [];
  if (!seen.includes(id)) await updateSettings({ seenHints: [...seen, id] });
}

/**
 * Одноразовая контекстная подсказка. Видима, пока пользователь не закрыл её
 * крестиком (факт хранится в settings.seenHints). Появляются только после
 * вводного тура — чтобы не наслаивать обучение на обучение.
 */
export function useHint(id: string): { visible: boolean; dismiss: () => void } {
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const visible =
    settings !== undefined &&
    Boolean(settings?.onboardingDone) &&
    !(settings?.seenHints ?? []).includes(id);
  return { visible, dismiss: () => void markHintSeen(id) };
}
