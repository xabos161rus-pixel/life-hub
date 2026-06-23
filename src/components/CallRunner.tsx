import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { listFamilyConfigs } from '../lib/family/familyState';
import { subscribeSignals } from '../lib/family/familyChat';
import { callManager, useCall } from '../lib/family/familyCall';
import { CallOverlay } from '../features/family/CallOverlay';

/** Слушает сигналы звонков по ВСЕМ включённым группам (чтобы входящий ловился
 *  на любом экране) и рендерит оверлей активного звонка поверх приложения.
 *  Соединения держит FamilyRunner — здесь только подписка на сигналы. */
export function CallRunner() {
  const sig = useLiveQuery(async () => {
    const cfgs = await listFamilyConfigs();
    return cfgs
      .filter((c) => c.enabled)
      .map((c) => c.familyId)
      .sort()
      .join(',');
  }, []);

  useEffect(() => {
    if (!sig) return;
    const ids = sig.split(',').filter(Boolean);
    const unsubs = ids.map((fid) => subscribeSignals(fid, (frame) => void callManager.onSignal(fid, frame)));
    return () => unsubs.forEach((u) => u());
  }, [sig]);

  const snap = useCall();
  if (snap.status === 'idle') return null;
  return <CallOverlay snap={snap} />;
}
