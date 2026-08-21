// Кнопка в шапке экрана, которую ставит вложенная вкладка.
//
// Шапку рисует внешний экран (имя группы, статус, звонок), а действие
// принадлежит вкладке внутри: поиск нужен на «Чате» и не нужен на
// «Участниках». Прокидывать состояние вкладки наверх пришлось бы через два
// слоя и тащить туда же обработчик.
//
// Своя строка под кнопку — плохой размен: на телефоне это два десятка
// пикселей переписки, а их и так не хватало (поле ввода когда-то уезжало за
// нижний край экрана именно из-за таких строк).

export interface ScreenAction {
  /** Значок из lucide-react или глифов проекта. */
  icon: unknown;
  label: string;
  onPress: () => void;
}

let current: ScreenAction | null = null;
const subs = new Set<() => void>();

function notify() {
  for (const cb of subs) cb();
}

/** Поставить кнопку в шапку. Возвращает функцию «убрать». */
export function setScreenAction(action: ScreenAction): () => void {
  current = action;
  notify();
  return () => {
    if (current === action) {
      current = null;
      notify();
    }
  };
}

export function screenAction(): ScreenAction | null {
  return current;
}

export function subscribeScreenAction(cb: () => void): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
