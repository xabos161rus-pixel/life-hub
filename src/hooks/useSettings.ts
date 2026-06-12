import { useLiveQuery } from 'dexie-react-hooks';
import { db, DEFAULT_SETTINGS } from '../db/db';
import type { Settings } from '../db/types';
import { now } from '../db/repo';

export function useSettings(): Settings {
  return useLiveQuery(() => db.settings.get('app'), []) ?? DEFAULT_SETTINGS;
}

export async function updateSettings(
  changes: Partial<Omit<Settings, 'id'>>,
): Promise<void> {
  await db.settings.update('app', { ...changes, updatedAt: now() });
}
