import { useEffect, useState } from 'react';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { connectionState, subscribeConnection } from '../../lib/family/familyChat';
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

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <span className="flex items-center gap-1.5 text-xs text-muted">
          <span className={`size-2 rounded-full ${conn === 'online' ? 'bg-success' : conn === 'connecting' ? 'bg-warning' : 'bg-muted'}`} />
          {CONN_LABEL[conn]}
        </span>
      </div>
      <SegmentedControl options={TABS} value={tab} onChange={setTab} />
      {tab === 'chat' ? <ChatTab /> : tab === 'tasks' ? <FamilyTasksTab /> : <MembersTab />}
    </div>
  );
}
