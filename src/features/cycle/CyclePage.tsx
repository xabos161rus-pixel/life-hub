import { useEffect, useState } from 'react';
import { Droplet, Info, Plus } from 'lucide-react';
import { Screen } from '../../components/layout/Screen';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';
import { ensureCycleSetup } from '../../lib/cycle/cycleRepo';
import { formatRu, todayKey } from '../../lib/dates';
import { plural } from '../../lib/plural';
import { CycleCalendar } from './CycleCalendar';
import { DayLogSheet } from './DayLogSheet';
import { useCycleData } from './useCycleData';
import type { CyclePredictionResult } from '../../lib/cycle/predict';

/** Как называем прогноз словами.
 *
 *  Диапазон показывается всегда, одиночная дата — никогда. Ширина диапазона
 *  должна быть постоянным элементом, а не тем, что появляется в плохие времена:
 *  иначе её сужение и расширение читается как поломка, а не как информация
 *  «мой цикл стал стабильнее». Формулировка «±2 дня» запрещена: при типичном
 *  разбросе это интервал, мимо которого промахивается каждый третий цикл,
 *  а «±2» человек читает как «точно». */
function predictionText(p: CyclePredictionResult): { title: string; note?: string } | null {
  if (p.confidence === 'none' || p.lo80 === undefined || p.hi80 === undefined) return null;

  const range = (from: string, to: string) =>
    from === to ? formatRu(from) : `${formatRu(from, 'd')}–${formatRu(to)}`;

  if (p.confidence === 'population_prior') {
    return {
      title: `Примерно ${range(p.lo80, p.hi80)}`,
      note: 'Пока это оценка по усреднённым данным, а не по твоим: циклов слишком мало.',
    };
  }
  if (p.confidence === 'very_wide') {
    return {
      title: `Между ${range(p.lo80, p.hi80)}`,
      note: 'Прогноз ориентировочный: разница между твоими циклами больше двух недель.',
    };
  }
  if (p.confidence === 'wide') {
    return {
      title: `Между ${range(p.lo80, p.hi80)}`,
      note: 'Твои циклы заметно разной длины, поэтому диапазон широкий.',
    };
  }
  return {
    title: `Скорее всего ${range(p.lo50!, p.hi50!)}`,
    note: `Обычно попадает в ${range(p.lo80, p.hi80)} — примерно в четырёх случаях из пяти.`,
  };
}

export function CyclePage() {
  const data = useCycleData();
  const [month, setMonth] = useState(() => todayKey().slice(0, 7) + '-01');
  const [pickedDate, setPickedDate] = useState<string | null>(null);

  // Справочник симптомов и настройки заводятся при первом открытии раздела, а
  // не при старте приложения: человек, который сюда не заходит, не должен
  // получить в базе таблицы, которые ему не нужны.
  useEffect(() => {
    void ensureCycleSetup();
  }, []);

  const { prediction, currentDay, stats, anomalies, settings } = data;
  const forecast = settings.predictionsEnabled ? predictionText(prediction) : null;

  return (
    <Screen
      title="Женские дни"
      backTo="/more"
      right={
        <button
          type="button"
          onClick={() => setPickedDate(todayKey())}
          className="shrink-0 rounded-lg px-2 py-1.5 text-sm font-medium text-accent active:opacity-60"
        >
          Отметить
        </button>
      }
    >
      <div className="space-y-5">
        {!data.hasAnyData && !data.loading ? (
          <EmptyState
            icon={Droplet}
            title="Пока нет ни одной отметки"
            hint="Отметь дни последней менструации — и появится календарь. Прогноз включится, когда наберётся хотя бы один полный цикл."
          />
        ) : (
          <>
            {/* Карточка «сейчас». Показывает факт (день цикла) и оценку
                (прогноз) раздельно и разными по весу: факт крупно, оценка
                мелко и с оговоркой. Смешивать их нельзя — человек запомнит
                оценку как факт. */}
            <div className="card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="min-w-0 text-sm font-medium text-muted">
                  {currentDay !== undefined ? 'День цикла' : 'Цикл'}
                </p>
                {stats.n > 0 && stats.averageLength !== undefined && (
                  <p className="shrink-0 text-xs text-muted">
                    в среднем {formatDays(stats.averageLength)}
                  </p>
                )}
              </div>
              <p className="mt-1 text-4xl font-bold tracking-[-0.02em] tabular-nums">
                {currentDay ?? '—'}
              </p>

              {forecast && (
                <div className="mt-3 rounded-xl bg-surface-2 p-3">
                  <p className="text-xs text-muted">Следующая менструация</p>
                  <p className="mt-0.5 font-semibold">{forecast.title}</p>
                  {forecast.note && (
                    <p className="mt-1 text-xs leading-snug text-muted">{forecast.note}</p>
                  )}
                  {prediction.daysPastPrediction > 0 && (
                    // Сознательно не «задержка»: это слово подразумевает вывод,
                    // который приложение делать не вправе.
                    <p className="mt-1.5 text-xs leading-snug text-muted">
                      Прошло на {prediction.daysPastPrediction}{' '}
                      {plural(prediction.daysPastPrediction, ['день', 'дня', 'дней'])} больше
                      ожидаемого. У циклов бывает разброс — это само по себе ни о чём не говорит.
                    </p>
                  )}
                </div>
              )}
            </div>

            <CycleCalendar
              data={data}
              month={month}
              onMonth={setMonth}
              onPick={(d) => setPickedDate(d)}
            />

            {anomalies.length > 0 && (
              <section>
                <h2 className="mb-1.5 flex items-center gap-1.5 px-1 text-sm font-semibold text-muted">
                  <Info size={15} className="shrink-0" />
                  Стоит обратить внимание
                </h2>
                <div className="card divide-y divide-hairline px-4">
                  {anomalies.map((a) => (
                    <div key={a.kind} className="py-3">
                      <p className="font-medium">{a.title}</p>
                      <p className="mt-0.5 text-sm leading-snug text-muted">{a.detail}</p>
                    </div>
                  ))}
                </div>
                {/* Оговорка обязательна и стоит рядом с наблюдениями, а не в
                    настройках: приложение считает по введённым отметкам и не
                    ставит диагнозов. */}
                <p className="mt-2 px-1 text-xs leading-snug text-muted">
                  Это наблюдения по твоим отметкам, а не диагноз. Приложение ничего не измеряет —
                  только считает то, что ты отметила.
                </p>
              </section>
            )}

            {stats.n > 0 && (
              <section>
                <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Статистика</h2>
                <div className="card divide-y divide-hairline px-4">
                  <Row label="Циклов учтено" value={String(stats.n)} />
                  {stats.medianLength !== undefined && (
                    <Row label="Обычная длина" value={`${stats.medianLength} дн.`} />
                  )}
                  {stats.shortestLength !== undefined && stats.longestLength !== undefined && (
                    <Row
                      label="Самый короткий и длинный"
                      value={`${stats.shortestLength} и ${stats.longestLength} дн.`}
                    />
                  )}
                  {stats.variability !== undefined && (
                    <Row
                      label="Разница между соседними"
                      value={`${stats.variability} дн.`}
                    />
                  )}
                  {stats.averagePeriodLength !== undefined && (
                    <Row label="Менструация" value={`${stats.averagePeriodLength} дн.`} />
                  )}
                  {/* Точность прогноза — то, чего не показывает ни один
                      конкурент. Цифра может оказаться неприятной; смягчать её
                      нельзя, можно только объяснить, что разброс биологический. */}
                  {data.accuracy.n >= 3 && (
                    <Row
                      label="Прогноз сбывался"
                      value={`${data.accuracy.hits} из ${data.accuracy.n}, ошибка ${data.accuracy.mae} дн.`}
                    />
                  )}
                </div>
              </section>
            )}
          </>
        )}

        {!data.hasAnyData && !data.loading && (
          <Button onClick={() => setPickedDate(todayKey())} className="w-full">
            <Plus size={18} className="-mt-0.5 mr-1 inline" /> Отметить сегодня
          </Button>
        )}
      </div>

      <DayLogSheet
        open={pickedDate !== null}
        date={pickedDate}
        onClose={() => setPickedDate(null)}
      />
    </Screen>
  );
}

/** «28 дней», но «28,4 дня»: при дробном числе русский требует родительного
 *  падежа единственного числа, и обычная плюрализация по последней цифре здесь
 *  даёт «28.4 дней». Заодно переводим точку в запятую. */
function formatDays(v: number): string {
  const isFraction = !Number.isInteger(v);
  const text = String(v).replace('.', ',');
  return `${text} ${isFraction ? 'дня' : plural(v, ['день', 'дня', 'дней'])}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-3">
      {/* Пол ширины подписи: без него длинное значение ужимает её до буквы. */}
      <span className="min-w-[6rem] flex-1 text-sm text-muted">{label}</span>
      <span className="shrink-0 font-semibold tabular-nums">{value}</span>
    </div>
  );
}
