import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { UserPlus, LogOut, Pencil, Phone, UserMinus } from 'lucide-react';
import { db } from '../../db/db';
import type { FamilyMember } from '../../db/types';
import { Button } from '../../components/ui/Button';
import { Sheet } from '../../components/ui/Sheet';
import { Field, Input } from '../../components/ui/Input';
import { getFamilyConfig } from '../../lib/family/familyState';
import { subscribePresence, renameFamily } from '../../lib/family/familyChat';
import { callManager } from '../../lib/family/familyCall';
import { leaveFamily } from '../../lib/family/familyLifecycle';
import { planRemoval, removeMember, type RemovalPlan } from '../../lib/family/familyKeys';
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
  const [removing, setRemoving] = useState<FamilyMember | null>(null);

  const alive = members.filter((m) => !m.leftAt).sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const self = alive.find((m) => m.id === selfId);
  // Исключать может только создатель группы: у него есть секрет владельца, и
  // только его сервер пустит. У остальных кнопки нет вовсе — показывать её,
  // чтобы потом отказать, хуже, чем не показывать.
  const isOwner = Boolean(config?.ownerSecret);

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
          <div key={m.id} className="flex w-full items-center gap-3 p-3">
            <button
              onClick={() => {
                if (m.id === selfId) setEditName(true);
              }}
              className="flex min-w-0 flex-1 items-center gap-3 text-left active:opacity-80"
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
                <span className={m.removedAt ? 'line-through opacity-60' : undefined}>{m.displayName}</span>
                {m.id === selfId ? (
                  <span className="text-muted"> · вы</span>
                ) : m.removedAt ? (
                  <span className="text-xs text-muted"> · исключён</span>
                ) : (
                  <span className="text-xs text-muted"> · {onlineSet.has(m.id) ? 'в сети' : 'не в сети'}</span>
                )}
              </span>
            </button>
            {m.id !== selfId && !m.removedAt && (
              <>
                {isOwner && (
                  <button
                    onClick={() => setRemoving(m)}
                    aria-label={`Исключить ${m.displayName}`}
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-danger/15 text-danger active:scale-95"
                  >
                    <UserMinus size={18} />
                  </button>
                )}
                <button
                  onClick={() => void callManager.startCall(familyId, m.id)}
                  aria-label={`Позвонить ${m.displayName}`}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-success/15 text-success active:scale-95"
                >
                  <Phone size={18} />
                </button>
              </>
            )}
          </div>
        ))}
      </div>

      <button onClick={() => void leave()} className="flex w-full items-center justify-center gap-2 pt-2 text-sm text-danger active:opacity-60">
        <LogOut size={16} />
        Выйти из группы
      </button>

      <RemoveMemberSheet
        key={removing?.id ?? 'rm-closed'}
        familyId={familyId}
        member={removing}
        onClose={() => setRemoving(null)}
      />
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

/** Подтверждение исключения. Здесь же — единственное место, где человеку
 *  говорят правду о границах: новые сообщения исключённый не прочитает, а
 *  скачанные раньше останутся при нём. Обещать большее нечестно, а промолчать
 *  значит дать понять, что переписка стёрлась и у него. */
function RemoveMemberSheet({
  familyId,
  member,
  onClose,
}: {
  familyId: string;
  member: FamilyMember | null;
  onClose: () => void;
}) {
  const [plan, setPlan] = useState<RemovalPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!member) return;
    let alive = true;
    void planRemoval(familyId, member.id).then((p) => {
      if (alive) setPlan(p);
    });
    return () => {
      alive = false;
    };
  }, [familyId, member]);

  async function confirm() {
    if (!member) return;
    setBusy(true);
    setError(null);
    try {
      await removeMember(familyId, member.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось исключить участника');
    } finally {
      setBusy(false);
    }
  }

  const stranded = plan?.stranded ?? [];

  return (
    <Sheet open={Boolean(member)} onClose={onClose} title={`Исключить ${member?.displayName ?? ''}?`}>
      <div className="space-y-4 pb-2">
        <ul className="space-y-2 text-sm leading-snug text-text/90">
          <li>Новые сообщения, задачи и звонки станут ему недоступны: группа перейдёт на новый ключ.</li>
          <li>Переписку, которую он уже скачал, вернуть нельзя — она осталась на его устройстве.</li>
          <li>Вернуть его можно только новым приглашением.</li>
        </ul>

        {stranded.length > 0 && (
          <div className="rounded-2xl border border-warning/40 bg-warning/10 p-3 text-sm leading-snug">
            {/* Не обновившиеся участники не получат новый ключ: передать его
                нечем. Молча выкинуть их вместе с исключённым нельзя. */}
            Вместе с ним группу потеряют: {stranded.map((m) => m.displayName).join(', ')}. У них старая
            версия приложения — новый ключ передать нечем. Попросите их открыть приложение и повторите.
          </div>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <Button
          className="w-full bg-danger text-white"
          disabled={busy || !plan}
          onClick={() => void confirm()}
        >
          {busy ? 'Исключаем…' : 'Исключить'}
        </Button>
        <button onClick={onClose} className="w-full py-2 text-sm text-muted active:opacity-60">
          Отмена
        </button>
      </div>
    </Sheet>
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
