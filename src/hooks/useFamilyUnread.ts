import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { hasAnyUnread } from '../lib/family/unread';

/** Есть ли непрочитанные сообщения хоть в одной семейной группе.
 *  Единый источник для бейджа в таб-баре и в списке разделов на «Главной». */
export function useFamilyUnread(): boolean {
  return (
    useLiveQuery(async () => {
      const cfgs = await db.family.toArray();
      if (!cfgs.length) return false;
      return hasAnyUnread(cfgs);
    }, []) ?? false
  );
}
