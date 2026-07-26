// Состояние замка раздела «Женские дни».
//
// Живёт в модуле, а не в компоненте и не в хранилище. В компоненте — потому
// что раздел должен оставаться открытым при переходе на его настройки и
// обратно. Не в localStorage — потому что тогда замок пережил бы перезагрузку
// и закрытие приложения, то есть не защищал бы ровно в тот момент, ради
// которого заводился: телефон дали подержать, вкладка осталась открытой.

let unlocked = false;
const listeners = new Set<() => void>();

export function isUnlocked(): boolean {
  return unlocked;
}

export function unlockCycleSection(): void {
  unlocked = true;
  listeners.forEach((l) => l());
}

export function lockCycleSection(): void {
  unlocked = false;
  listeners.forEach((l) => l());
}

export function subscribeLock(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
