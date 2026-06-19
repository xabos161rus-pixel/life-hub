import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../../components/layout/Screen';
import { getFamilyConfig } from '../../lib/family/familyState';
import { FamilyOnboarding } from './FamilyOnboarding';
import { FamilyScreen } from './FamilyScreen';

export function FamilyPage() {
  const config = useLiveQuery(() => getFamilyConfig(), []);
  return (
    <Screen title={config ? config.familyName : 'Семья'} backTo="/more" fill={!!config}>
      {config ? <FamilyScreen /> : <FamilyOnboarding />}
    </Screen>
  );
}
