import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus } from 'lucide-react';
import { db } from '../../db/db';
import type { FamilyConfig } from '../../db/types';
import { Screen } from '../../components/layout/Screen';
import { Sheet } from '../../components/ui/Sheet';
import { Button } from '../../components/ui/Button';
import { listFamilyConfigs } from '../../lib/family/familyState';
import { FamilyOnboarding, CreateFamilySheet, JoinFamilySheet } from './FamilyOnboarding';
import { FamilyScreen } from './FamilyScreen';

const ACTIVE_KEY = 'life-hub-active-family';

export function FamilyPage() {
  const configs = useLiveQuery(() => listFamilyConfigs(), []);
  const [sp, setSp] = useSearchParams();
  const [addMode, setAddMode] = useState<null | 'choose' | 'create' | 'join'>(null);

  // Выбранная группа живёт в URL (?g=…): так переход по пуш-уведомлению (открыть
  // конкретный чат) надёжно переключает группу, даже если открыта другая.
  const select = (id: string) => {
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* приватный режим */
    }
    setSp({ g: id }, { replace: true });
  };

  if (!configs)
    return (
      <Screen title="Семья" backTo="/more">
        <div />
      </Screen>
    );

  if (configs.length === 0) {
    return (
      <Screen title="Семья" backTo="/more">
        <FamilyOnboarding onReady={select} />
      </Screen>
    );
  }

  const ids = configs.map((c) => c.familyId);
  const fromUrl = sp.get('g');
  const fromLs = (() => {
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  })();
  const selected = fromUrl && ids.includes(fromUrl) ? fromUrl : fromLs && ids.includes(fromLs) ? fromLs : ids[0];
  const current = configs.find((c) => c.familyId === selected)!;

  return (
    <Screen title={current.familyName} backTo="/more" fill>
      <div className="flex h-full flex-col">
        <GroupSwitcher configs={configs} selected={selected} onSelect={select} onAdd={() => setAddMode('choose')} />
        <div className="min-h-0 flex-1">
          {/* key=selected: смена группы полностью перемонтирует экран (чистый
              сброс вкладки/подписок), без ручного разбора переходов. */}
          <FamilyScreen
            key={selected}
            familyId={selected}
            onLeft={() => {
              const sib = ids.find((i) => i !== selected);
              if (sib) {
                select(sib);
              } else {
                try {
                  localStorage.removeItem(ACTIVE_KEY);
                } catch {
                  /* приватный режим */
                }
                setSp({}, { replace: true });
              }
            }}
          />
        </div>
      </div>

      <Sheet open={addMode === 'choose'} onClose={() => setAddMode(null)} title="Добавить группу">
        <div className="space-y-3 pb-2">
          <Button className="w-full" onClick={() => setAddMode('create')}>
            Создать группу
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => setAddMode('join')}>
            Войти по приглашению
          </Button>
        </div>
      </Sheet>
      <CreateFamilySheet
        open={addMode === 'create'}
        onClose={() => setAddMode(null)}
        onReady={(id) => {
          setAddMode(null);
          select(id);
        }}
      />
      <JoinFamilySheet
        open={addMode === 'join'}
        onClose={() => setAddMode(null)}
        onReady={(id) => {
          setAddMode(null);
          select(id);
        }}
      />
    </Screen>
  );
}

function GroupSwitcher({
  configs,
  selected,
  onSelect,
  onAdd,
}: {
  configs: FamilyConfig[];
  selected: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const msgs = useLiveQuery(() => db.familyMessages.toArray(), []);
  const unread = useMemo(() => {
    const map: Record<string, number> = {};
    const cfgById = Object.fromEntries(configs.map((c) => [c.familyId, c]));
    for (const c of configs) map[c.familyId] = 0;
    for (const m of msgs ?? []) {
      const c = cfgById[m.familyId];
      if (!c || m.deletedAt || m.seq == null) continue;
      if (m.seq > c.lastReadSeq && m.senderMemberId !== c.selfMemberId) map[m.familyId]++;
    }
    return map;
  }, [msgs, configs]);

  return (
    <div className="shrink-0 -mx-1 flex gap-2 overflow-x-auto px-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {configs.map((c) => {
        const active = c.familyId === selected;
        const n = unread[c.familyId] ?? 0;
        return (
          <button
            key={c.familyId}
            onClick={() => onSelect(c.familyId)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium active:opacity-80 ${
              active ? 'bg-gradient-to-br from-accent to-accent-2 text-white shadow-accent' : 'bg-surface-2 text-muted'
            }`}
          >
            <span className="max-w-[9rem] truncate">{c.familyName || 'Семья'}</span>
            {n > 0 && (
              <span
                className={`flex min-w-[1.1rem] items-center justify-center rounded-full px-1 text-[11px] font-bold leading-none ${
                  active ? 'bg-white/25 text-white' : 'bg-accent text-white'
                }`}
              >
                {n > 99 ? '99+' : n}
              </span>
            )}
          </button>
        );
      })}
      <button
        onClick={onAdd}
        aria-label="Добавить группу"
        className="flex size-8 shrink-0 items-center justify-center self-center rounded-full bg-surface-2 text-muted active:opacity-80"
      >
        <Plus size={18} />
      </button>
    </div>
  );
}
