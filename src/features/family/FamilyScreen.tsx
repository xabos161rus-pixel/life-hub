import { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { connectionState, subscribeConnection, registerFamilyPush } from '../../lib/family/familyChat';
import { pushEnabled, pushSupported, isStandalone, enablePush } from '../../lib/push';
import { MembersTab } from './MembersTab';
import { ChatTab } from './ChatTab';
import { FamilyTasksTab } from './FamilyTasksTab';

type Tab = 'chat' | 'tasks' | 'members';
const TABS = [
  { value: 'chat' as const, label: 'Чат' },
  { value: 'tasks' as const, label: 'Задачи' },
  { value: 'members' as const, label: 'Участники' },
];

function useConnection() {
  const [s, setS] = useState(connectionState());
  useEffect(() => subscribeConnection(setS), []);
  return s;
}

const CONN_LABEL: Record<string, string> = { offline: 'не в сети', connecting: 'подключение…', online: 'на связи' };

export function FamilyScreen() {
  const [tab, setTab] = useState<Tab>('chat');
  const conn = useConnection();
  const [pushOn, setPushOn] = useState(pushEnabled());
  const [pushHidden, setPushHidden] = useState(false);

  async function enableFamilyPush() {
    if (!pushSupported()) {
      alert('Уведомления не поддерживаются этим браузером.');
      return;
    }
    if (!isStandalone()) {
      alert('Уведомления работают только в установленном приложении. Добавьте Life Hub на экран «Домой» и откройте оттуда.');
      return;
    }
    const res = await enablePush();
    if (!res.ok) {
      alert(res.reason === 'denied' ? 'Разрешение не выдано. Включите в настройках устройства.' : 'Не удалось включить уведомления.');
      return;
    }
    await registerFamilyPush();
    setPushOn(true);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className={`size-2 rounded-full ${conn === 'online' ? 'bg-success' : conn === 'connecting' ? 'bg-warning' : 'bg-muted'}`} />
          {CONN_LABEL[conn]}
        </span>
      </div>
      {!pushOn && !pushHidden && (
        <div className="flex items-center gap-2 rounded-xl bg-accent/10 p-3 text-sm">
          <BellRing size={18} className="shrink-0 text-accent" />
          <span className="flex-1">Включите уведомления, чтобы знать о новых сообщениях</span>
          <button onClick={() => void enableFamilyPush()} className="shrink-0 font-semibold text-accent active:opacity-60">
            Включить
          </button>
          <button onClick={() => setPushHidden(true)} aria-label="Скрыть" className="shrink-0 p-0.5 text-muted active:opacity-60">
            <X size={16} />
          </button>
        </div>
      )}
      <SegmentedControl options={TABS} value={tab} onChange={setTab} />
      {tab === 'chat' ? <ChatTab /> : tab === 'tasks' ? <FamilyTasksTab /> : <MembersTab />}
    </div>
  );
}
