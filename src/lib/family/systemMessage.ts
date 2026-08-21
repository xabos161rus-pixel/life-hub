import { t } from '../i18n';
import type { FamilyMessage, FamilySystemEvent } from '../../db/types';

// Текст системной плашки чата. Типизированное событие (kind + params)
// раскрывается в строку В МОМЕНТ РЕНДЕРА — каждый участник читает его на
// своём языке, хотя отправитель мог писать на другом. Событие приезжает с
// провода, то есть это данные, а не тип: перед раскрытием — проверка формы,
// всё непонятное честно падает в text (язык автора, как в старой истории).

/** Длительность звонка «М:СС» — формат журнала звонков в ленте. */
export function formatCallDuration(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function validated(sys: unknown): FamilySystemEvent | null {
  if (!sys || typeof sys !== 'object') return null;
  const s = sys as Record<string, unknown>;
  if (s.kind === 'join' && (s.name == null || typeof s.name === 'string')) {
    const name = typeof s.name === 'string' ? s.name.trim() : '';
    return name ? { kind: 'join', name } : { kind: 'join' };
  }
  if (s.kind === 'call' && typeof s.sec === 'number' && Number.isFinite(s.sec)) {
    // Floor ДО проверки: sec 0.5 — это «0:00», такому событию нечего показывать.
    const sec = Math.floor(s.sec);
    if (sec > 0) return { kind: 'call', sec };
  }
  if (s.kind === 'callMissed') return { kind: 'callMissed' };
  return null;
}

/** Строка события на языке текущего интерфейса (t — в момент вызова). */
export function systemEventText(sys: FamilySystemEvent): string {
  switch (sys.kind) {
    case 'join':
      return t('{name} теперь в группе', { name: sys.name ?? t('Участник') });
    case 'call':
      return t('📞 Аудиозвонок · {dur}', { dur: formatCallDuration(sys.sec) });
    case 'callMissed':
      return t('📵 Пропущенный аудиозвонок');
  }
}

/** Текст плашки для сообщения: типизированное событие — на языке зрителя;
 *  без события или с незнакомым/битым kind — сохранённый text как есть. */
export function systemMessageText(m: Pick<FamilyMessage, 'text' | 'sys'>): string {
  const sys = validated(m.sys);
  return sys ? systemEventText(sys) : m.text;
}
