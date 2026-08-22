import { useEffect, useState } from 'react';
import { db } from '../../db/db';
import { alive } from '../../db/repo';
import { todayKey } from '../../lib/dates';
import { levelByDate } from '../../lib/energy';
import { isActiveOn, isLogDone } from '../../lib/habits';

/**
 * Что было сделано на момент ОТКРЫТИЯ экрана «Сегодня».
 *
 * Снимок, а не живой запрос — в этом весь смысл. По нему решается, что
 * сворачивать в полосу дня, и решение не должно меняться под пальцем: отметку,
 * поставленную только что, снимают повторным тапом по той же цифре, а список
 * привычек, закрытый секунду назад, не должен исчезать из-под руки.
 *
 * Снимок живёт в одном месте на оба блока и на саму полосу: раньше правило
 * «показывать ли ячейку» стояло в полосе, а правило «сворачиваться ли» — в
 * блоке, и они разошлись — значение выводилось дважды, в полосе и в блоке
 * сразу.
 *
 * `ready: false` — снимок ещё не снят: до этого момента ничего не сворачиваем,
 * иначе на медленной базе экран моргнёт свёрнутым состоянием.
 */
export function useDayOpenSnapshot(): {
  ready: boolean;
  energyMarked: boolean;
  habitsClosed: boolean;
} {
  const today = todayKey();
  const [snap, setSnap] = useState<{ energyMarked: boolean; habitsClosed: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    void Promise.all([db.energyLogs.toArray(), db.habits.toArray(), db.habitLogs.toArray()]).then(
      ([energyLogs, habits, habitLogs]) => {
        if (!live) return;
        const due = alive(habits).filter((h) => !h.archivedAt && isActiveOn(h, today));
        const byHabit = new Map(
          alive(habitLogs)
            .filter((l) => l.date === today)
            .map((l) => [l.habitId, l]),
        );
        setSnap({
          energyMarked: levelByDate(alive(energyLogs)).get(today) != null,
          // Пустой список не «закрыт»: сворачивать нечего и показывать нечего.
          habitsClosed:
            due.length > 0 &&
            due.every((h) => {
              const log = byHabit.get(h.id);
              return log ? isLogDone(h, log.value) : false;
            }),
        });
      },
    );
    return () => {
      live = false;
    };
  }, [today]);

  return { ready: snap != null, energyMarked: snap?.energyMarked ?? false, habitsClosed: snap?.habitsClosed ?? false };
}
