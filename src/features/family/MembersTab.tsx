import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { UserPlus, LogOut } from 'lucide-react';
import { useNavigate } from 'react-router';
import { db } from '../../db/db';
import { Button } from '../../components/ui/Button';
import { getFamilyConfig } from '../../lib/family/familyState';
import { leaveFamily } from '../../lib/family/familyLifecycle';
import { FamilyInviteSheet } from './FamilyInviteSheet';
import { ProfileNameSheet } from './ProfileNameSheet';

export function MembersTab() {
  const members = useLiveQuery(() => db.familyMembers.toArray(), []) ?? [];
  const config = useLiveQuery(() => getFamilyConfig(), []);
  const navigate = useNavigate();
  const selfId = config?.selfMemberId;
  const [invite, setInvite] = useState(false);
  const [editName, setEditName] = useState(false);

  const alive = members.filter((m) => !m.leftAt).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const self = alive.find((m) => m.id === selfId);

  async function leave() {
    if (!window.confirm('Выйти из семьи? Общий чат и задачи перестанут синхронизироваться на этом устройстве.')) return;
    await leaveFamily();
    navigate('/more');
  }

  return (
    <div className="space-y-3">
      <Button onClick={() => setInvite(true)} className="w-full inline-flex items-center justify-center gap-2">
        <UserPlus size={18} />
        Пригласить родственника
      </Button>

      <div className="divide-y divide-hairline overflow-hidden rounded-2xl border border-border bg-surface">
        {alive.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              if (m.id === selfId) setEditName(true);
            }}
            className="flex w-full items-center gap-3 p-3 text-left active:opacity-80"
          >
            <span
              className="flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ background: m.color }}
            >
              {m.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">
              {m.displayName}
              {m.id === selfId && <span className="text-muted"> · вы</span>}
            </span>
          </button>
        ))}
      </div>

      <button onClick={() => void leave()} className="flex w-full items-center justify-center gap-2 pt-2 text-sm text-danger active:opacity-60">
        <LogOut size={16} />
        Выйти из семьи
      </button>

      <FamilyInviteSheet open={invite} onClose={() => setInvite(false)} />
      <ProfileNameSheet open={editName} currentName={self?.displayName ?? ''} onClose={() => setEditName(false)} />
    </div>
  );
}
