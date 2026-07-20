import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';

/** Есть ли непрочитанные сообщения хоть в одной семейной группе.
 *  Единый источник для бейджа в таб-баре и в меню «Ещё». */
export function useFamilyUnread(): boolean {
  return (
    useLiveQuery(async () => {
      const cfgs = await db.family.toArray();
      if (!cfgs.length) return false;
      const byId = Object.fromEntries(cfgs.map((c) => [c.familyId, c]));
      const msgs = await db.familyMessages.toArray();
      return msgs.some((m) => {
        const c = byId[m.familyId];
        return (
          c &&
          !m.deletedAt &&
          m.seq != null &&
          m.seq > c.lastReadSeq &&
          m.senderMemberId !== c.selfMemberId
        );
      });
    }, []) ?? false
  );
}
