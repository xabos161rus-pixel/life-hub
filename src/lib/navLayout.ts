import type { SectionId } from './sections';

// Чистая логика раскладки навигации — специально без импорта иконок/React, чтобы
// её можно было гонять юнит-тестами напрямую. Из реестра разделов и сохранённого
// конфига собирает три списка: нижняя панель, список «Ещё», скрытые. Любой
// «битый» конфиг (несуществующие id, дубли, скрытый якорь, перебор лимита)
// нормализуется — UI никогда не должен получить некорректную раскладку.

/** Что хранится в settings (device-local). Строки, а не SectionId — на входе
 *  данные не доверенные, валидируются здесь. */
export interface NavConfig {
  bottom: string[]; // пользовательские разделы панели, по порядку (без якоря «Ещё»)
  hidden: string[]; // спрятанные разделы
}

export interface NavRegistryItem {
  id: SectionId;
  anchor?: boolean;
  nonHideable?: boolean;
}

export interface NavLayout {
  bottom: SectionId[]; // id для панели, включая якорь последним
  more: SectionId[]; // id для списка «Ещё», по порядку
  hidden: SectionId[]; // спрятанные id
}

export interface NavLayoutOpts {
  maxBottom: number; // сколько пользовательских разделов влезает слева от якоря
  defaultBottom: SectionId[]; // панель по умолчанию, если конфига нет
  anchorId: SectionId; // «Ещё» — всегда последний слот панели
}

export function computeNavLayout(
  registry: NavRegistryItem[],
  config: Partial<NavConfig> | undefined,
  opts: NavLayoutOpts,
): NavLayout {
  const { maxBottom, defaultBottom, anchorId } = opts;
  const byId = new Map<string, NavRegistryItem>(registry.map((s) => [s.id, s]));
  const isNonHideable = (id: string) => Boolean(byId.get(id)?.nonHideable);
  const isAnchor = (id: string) => Boolean(byId.get(id)?.anchor);

  // Скрытые: существующие id, кроме нескрываемых и якоря. Дубли схлопывает Set.
  const hiddenSet = new Set<SectionId>();
  for (const id of config?.hidden ?? []) {
    if (!byId.has(id) || isNonHideable(id) || isAnchor(id)) continue;
    hiddenSet.add(id as SectionId);
  }

  // Панель: из конфига (или дефолта), существующие, не якорь, не скрытые,
  // уникальные, не больше лимита. Якорь сюда не попадает — добавим в конец.
  const source = config?.bottom ?? defaultBottom;
  const inBottom = new Set<SectionId>();
  const bottomIds: SectionId[] = [];
  for (const raw of source) {
    const id = raw as SectionId;
    if (!byId.has(id) || isAnchor(id) || hiddenSet.has(id) || inBottom.has(id)) continue;
    inBottom.add(id);
    bottomIds.push(id);
    if (bottomIds.length >= maxBottom) break;
  }

  // «Ещё»: всё из реестра, кроме якоря, скрытых и того, что ушло в панель —
  // в порядке реестра (настройка порядка внутри «Ещё» — следующий шаг).
  const moreIds: SectionId[] = [];
  for (const s of registry) {
    if (isAnchor(s.id) || hiddenSet.has(s.id) || inBottom.has(s.id)) continue;
    moreIds.push(s.id);
  }

  return {
    bottom: [...bottomIds, anchorId],
    more: moreIds,
    hidden: [...hiddenSet],
  };
}
