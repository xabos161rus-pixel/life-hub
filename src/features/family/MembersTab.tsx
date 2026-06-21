import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { UserPlus, LogOut, Pencil } from 'lucide-react';
import { db } from '../../db/db';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { Field, Input } from '../../components/ui/Input';
import { getFamilyConfig } from '../../lib/family/familyState';
import { subscribePresence, renameFamily } from '../../lib/family/familyChat';
import { leaveFamily } from '../../lib/family/familyLifecycle';
import { FamilyInviteSheet } from './FamilyInviteSheet';
import { ProfileNameSheet } from './ProfileNameSheet';

export function MembersTab({ familyId, onLeft }: { familyId: string; onLeft: () => void }) {
  const members = useLiveQuery(() => db.familyMembers.where('familyId').equals(familyId).toArray(), [familyId]) ?? [];
  const config = useLiveQuery(() => getFamilyConfig(familyId), [familyId]);
  const selfId = config?.selfMemberId;
  const [online, setOnline] = useState<string[]>([]);
  useEffect(() => subscribePresence(familyId, setOnline), [familyId]);
  const onlineSet = new Set(online);
  const [invite, setInvite] = useState(false);
  const [editName, setEditName] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const alive = members.filter((m) => !m.leftAt).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const self = alive.find((m) => m.id === selfId);

  async function leave() {
    if (!window.confirm('Выйти из группы? Её общий чат и задачи перестанут синхронизироваться на этом устройстве.')) return;
    await leaveFamily(familyId);
    onLeft();
  }

  return (
    <div className="space-y-3">
      <button
        onClick={() => setRenaming(true)}
        className="flex w-full items-center gap-2 rounded-2xl border border-border bg-surface px-4 py-3 text-left active:opacity-80"
      >
        <Pencil size={16} className="shrink-0 text-muted" />
        <span className="flex-1 truncate font-medium">{config?.familyName || 'Семья'}</span>
        <span className="text-sm text-muted">Переименовать</span>
      </button>

      <Button onClick={() => setInvite(true)} className="w-full inline-flex items-center justify-center gap-2">
        <UserPlus size={18} />
        Пригласить участника
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
            <span className="relative shrink-0">
              <span
                className="flex size-9 items-center justify-center rounded-full text-sm font-semibold text-white"
                style={{ background: m.color }}
              >
                {m.displayName.slice(0, 1).toUpperCase()}
              </span>
              {(onlineSet.has(m.id) || m.id === selfId) && (
                <span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-success ring-2 ring-surface" />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">
              {m.displayName}
              {m.id === selfId ? (
                <span className="text-muted"> · вы</span>
              ) : (
                <span className="text-xs text-muted"> · {onlineSet.has(m.id) ? 'в сети' : 'не в сети'}</span>
              )}
            </span>
          </button>
        ))}
      </div>

      <button onClick={() => void leave()} className="flex w-full items-center justify-center gap-2 pt-2 text-sm text-danger active:opacity-60">
        <LogOut size={16} />
        Выйти из группы
      </button>

      <FamilyInviteSheet familyId={familyId} open={invite} onClose={() => setInvite(false)} />
      <ProfileNameSheet familyId={familyId} open={editName} currentName={self?.displayName ?? ''} onClose={() => setEditName(false)} />
      <RenameSheet
        key={renaming ? `rn-${config?.familyName ?? ''}` : 'rn-closed'}
        familyId={familyId}
        open={renaming}
        current={config?.familyName ?? ''}
        onClose={() => setRenaming(false)}
      />
    </div>
  );
}

function RenameSheet({ familyId, open, current, onClose }: { familyId: string; open: boolean; current: string; onClose: () => void }) {
  const [name, setName] = useState(current);

  async function save() {
    if (!name.trim()) return;
    await renameFamily(familyId, name);
    onClose();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Название группы">
      <div className="space-y-4">
        <Field label="Название группы">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, «Наша семья»" autoFocus />
        </Field>
        <Button className="w-full" disabled={!name.trim()} onClick={() => void save()}>
          Сохранить
        </Button>
      </div>
    </Sheet>
  );
}
