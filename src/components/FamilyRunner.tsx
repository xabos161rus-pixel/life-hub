import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getFamilyConfig } from '../lib/family/familyState';
import { connect, disconnect } from '../lib/family/familyChat';

/** Держит семейный WebSocket живым, пока приложение открыто и семья настроена.
 *  Переподключается при возврате в приложение и появлении сети. connect сам
 *  идемпотентен; при разрыве движок делает backfill по курсору. */
export function FamilyRunner() {
  const config = useLiveQuery(() => getFamilyConfig(), []);
  const enabled = !!config?.enabled;
  useEffect(() => {
    if (!enabled) {
      disconnect();
      return;
    }
    const wake = () => {
      if (document.visibilityState === 'visible') void connect();
    };
    void connect();
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    window.addEventListener('focus', wake);
    return () => {
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
      window.removeEventListener('focus', wake);
    };
  }, [enabled]);
  return null;
}
