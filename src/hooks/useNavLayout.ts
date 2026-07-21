import { useMemo } from 'react';
import { useSettings } from './useSettings';
import {
  SECTIONS,
  SECTION_BY_ID,
  MAX_BOTTOM,
  DEFAULT_BOTTOM,
  ANCHOR_ID,
  type Section,
} from '../lib/sections';
import { computeNavLayout } from '../lib/navLayout';

export interface ResolvedNavLayout {
  bottom: Section[]; // разделы нижней панели, «Ещё» последним
  more: Section[]; // разделы списка «Ещё», по порядку
  hidden: string[]; // id спрятанных
}

/** Раскладка навигации из settings.navConfig, нормализованная и разрешённая в
 *  объекты разделов. Единый источник для TabBar, MorePage и превью в настройке. */
export function useNavLayout(): ResolvedNavLayout {
  const settings = useSettings();
  const navConfig = settings.navConfig;
  return useMemo(() => {
    const layout = computeNavLayout(SECTIONS, navConfig, {
      maxBottom: MAX_BOTTOM,
      defaultBottom: DEFAULT_BOTTOM,
      anchorId: ANCHOR_ID,
    });
    const resolve = (ids: string[]) =>
      ids.map((id) => SECTION_BY_ID.get(id)).filter((s): s is Section => Boolean(s));
    return { bottom: resolve(layout.bottom), more: resolve(layout.more), hidden: layout.hidden };
  }, [navConfig]);
}
