import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { BellRing } from 'lucide-react';
import {
  GClose as X,
} from '../../components/ui/glyphs';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { connectionState, subscribeConnection, registerAllFamilyPush } from '../../lib/family/familyChat';
import { getFamilyConfig } from '../../lib/family/familyState';
import { pushEnabled, pushSupported, isStandalone, enablePush } from '../../lib/push';
import { MembersTab } from './MembersTab';
import { ChatTab } from './ChatTab';
import { FamilyTasksTab } from './FamilyTasksTab';
import { useToast } from '../../components/ui/toastContext';
import { getLang, t } from '../../lib/i18n';
import { HIT_SLOP_44 } from '../../components/ui/hitSlop';

type Tab = 'chat' | 'tasks' | 'members';
const TABS = [
  { value: 'chat' as const, label: 'Чат' },
  { value: 'tasks' as const, label: 'Задачи' },
  { value: 'members' as const, label: 'Участники' },
];

function useConnection(familyId: string) {
  const [s, setS] = useState(connectionState(familyId));
  useEffect(() => subscribeConnection(familyId, setS), [familyId]);
  return s;
}

const CONN_LABEL: Record<string, string> = { offline: 'не в сети', connecting: 'подключение…', online: 'на связи' };

/** Статус соединения для подзаголовка шапки: «на связи» / «подключение…» /
 *  «не в сети». Живёт здесь, а рендерится в FamilyPage: раньше статус занимал
 *  собственную строку в теле экрана, и вместе со свитчером групп и баннерами
 *  лента чата не влезала в экран вовсе. Только соединение, без счётчиков:
 *  присутствие СОБЕСЕДНИКОВ (кто онлайн, «был(а) в сети…», «печатает») — зона
 *  ответственности строки внутри ChatTab, второй счётчик был бы дублем. */
export function useFamilyStatusLine(familyId: string): string {
  const conn = useConnection(familyId);
  return t(CONN_LABEL[conn]);
}

export function FamilyScreen({ familyId, onLeft, onAddGroup }: { familyId: string; onLeft: () => void; onAddGroup?: () => void }) {
  const [tab, setTab] = useState<Tab>('chat');
  const config = useLiveQuery(() => getFamilyConfig(familyId), [familyId]);
  const toast = useToast();
  const [pushOn, setPushOn] = useState(pushEnabled());
  const [pushHidden, setPushHidden] = useState(false);

  async function enableFamilyPush() {
    if (!pushSupported()) {
      toast(t('Уведомления не поддерживаются этим браузером.'));
      return;
    }
    if (!isStandalone()) {
      toast(t('Уведомления работают только в установленном приложении. Добавьте LifeHearth на экран «Домой» и откройте оттуда.'));
      return;
    }
    const res = await enablePush();
    if (!res.ok) {
      toast(res.reason === 'denied' ? t('Разрешение не выдано. Включите в настройках устройства.') : t('Не удалось включить уведомления. Проверьте разрешения в настройках устройства'));
      return;
    }
    await registerAllFamilyPush();
    setPushOn(true);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-3 pb-3">
        {config?.removedAt ? (
          // Молчаливое «не в сети» тут было бы обманом: человек чинил бы связь,
          // которой больше нет. Переписку оставляем — она его, и стирать её
          // вдогонку к исключению незачем.
          <div className="rounded-xl bg-danger/10 p-3 text-sm leading-snug text-danger">
            {t('Вас исключили из этой группы. Переписка на этом устройстве осталась, но новые сообщения приходить не будут.')}
          </div>
        ) : null}
        {/* Статус соединения здесь больше не рендерится — он ушёл в подзаголовок
            шапки (useFamilyStatusLine): каждая служебная строка над чатом — это
            минус строка переписки на экране. */}
        {!pushOn && !pushHidden && (
          <div className="flex items-center gap-2 rounded-xl bg-accent/10 px-3 py-2 text-sm">
            <BellRing size={16} className="shrink-0 text-accent" />
            {/* Короткая формулировка намеренно: длинная растягивала баннер на
                три строки и вместе с остальной шапкой выталкивала чат за экран. */}
            <span className="min-w-0 flex-1">{t('Уведомления')}</span>
            <button onClick={() => void enableFamilyPush()} className="shrink-0 font-semibold text-accent active:opacity-60">
              {/* «Включить» в словаре занято звуком чата ('Unmute') — здесь смысл
                  «разрешить уведомления», английская ветка явная. */}
              {getLang() === 'en' ? 'Turn on' : 'Включить'}
            </button>
            <button
              onClick={() => setPushHidden(true)}
              aria-label={t('Скрыть')}
              className={`ml-1 shrink-0 p-1.5 text-muted active:opacity-60 ${HIT_SLOP_44}`}
            >
              <X size={16} />
            </button>
          </div>
        )}
        <SegmentedControl options={TABS.map((o) => ({ ...o, label: t(o.label) }))} value={tab} onChange={setTab} />
      </div>
      {/* Для чата — без внешнего скролла (ChatTab имеет свой), иначе два
          вложенных overflow-y-auto давали «войну скроллов» и заморозку. */}
      <div className={`min-h-0 flex-1 ${tab === 'chat' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {tab === 'chat' ? (
          <ChatTab familyId={familyId} />
        ) : tab === 'tasks' ? (
          <FamilyTasksTab familyId={familyId} />
        ) : (
          <MembersTab familyId={familyId} onLeft={onLeft} onAddGroup={onAddGroup} />
        )}
      </div>
    </div>
  );
}
