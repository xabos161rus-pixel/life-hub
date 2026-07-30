import { useMemo, useState, useSyncExternalStore } from 'react';
import { Printer } from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Screen } from '../../components/layout/Screen';
import { Button } from '../../components/ui/Button';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { db } from '../../db/db';
import { formatRu } from '../../lib/dates';
import { plur, plural } from '../../lib/plural';
import { buildDoctorReport, type DoctorReportWindow } from '../../lib/cycle/report';
import { useCycleData } from './useCycleData';
import { CycleLock } from './CycleLock';
import { isUnlocked, subscribeLock } from './lockState';

const WINDOW_OPTIONS: { value: DoctorReportWindow; label: string }[] = [
  { value: 'last2cycles', label: '2 цикла' },
  { value: '6months', label: '6 месяцев' },
  { value: '12months', label: '12 месяцев' },
];

/** «28 дней», но «28,4 дня» — как в CyclePage.tsx: при дробном числе нужен
 *  родительный падеж единственного числа, а не форма по последней цифре
 *  (иначе «28.4 дней»). Своя копия здесь, а не импорт из CyclePage: там
 *  функция не экспортирована, а трогать этот файл в рамках задачи нельзя. */
function formatDays(v: number): string {
  const isFraction = !Number.isInteger(v);
  const text = String(v).replace('.', ',');
  return `${text} ${isFraction ? 'дня' : plural(v, ['день', 'дня', 'дней'])}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-3">
      <span className="min-w-[6rem] flex-1 text-sm text-muted">{label}</span>
      <span className="shrink-0 font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function CycleReportPage() {
  const data = useCycleData();
  const episodes = useLiveQuery(() => db.cycleEpisodes.toArray(), []) ?? [];
  const symptomDefs = useLiveQuery(() => db.cycleSymptoms.toArray(), []) ?? [];
  const [reportWindow, setReportWindow] = useState<DoctorReportWindow>('6months');

  // Замок раздела — тот же паттерн, что в CyclePage.tsx: разблокировка живёт в
  // памяти модуля и не переживает перезагрузку страницы.
  const open = useSyncExternalStore(subscribeLock, isUnlocked, () => false);
  const locked = data.settings.lock === 'pin' && data.settings.pin !== undefined && !open;

  const report = useMemo(
    () =>
      buildDoctorReport({
        days: data.days,
        cycles: data.cycles,
        episodes,
        symptoms: symptomDefs,
        anomalies: data.anomalies,
        window: reportWindow,
        today: data.today,
      }),
    [data.days, data.cycles, episodes, symptomDefs, data.anomalies, reportWindow, data.today],
  );

  const periodText =
    report.periodFrom === report.periodTo
      ? formatRu(report.periodFrom, 'd MMMM yyyy')
      : `${formatRu(report.periodFrom, 'd MMMM yyyy')} — ${formatRu(report.periodTo, 'd MMMM yyyy')}`;

  return (
    <Screen title="Отчёт для врача" backTo="/more/cycle/settings">
      {locked ? (
        <CycleLock settings={data.settings} onUnlock={() => undefined} />
      ) : (
        <div className="space-y-5">
          {/* Переключатель окна — только на экране, в печать не идёт. */}
          <div className="print:hidden">
            <SegmentedControl options={WINDOW_OPTIONS} value={reportWindow} onChange={setReportWindow} />
          </div>

          {/* Дальше — само содержимое отчёта: то, что уходит на печать целиком. */}
          <div className="space-y-5">
            <div className="card p-4">
              <p className="text-sm text-muted">Составлено {formatRu(report.generatedAt, 'd MMMM yyyy')}</p>
              <p className="mt-0.5 font-semibold">Период: {periodText}</p>
            </div>

            <section>
              <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Циклы периода</h2>
              {report.cycles.length === 0 ? (
                <div className="card p-4">
                  <p className="text-sm text-muted">За выбранный период отметок нет.</p>
                </div>
              ) : (
                <div className="card divide-y divide-hairline px-4">
                  {report.cycles.map((c) => (
                    <div key={c.startDate} className="py-3">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{formatRu(c.startDate, 'd MMMM yyyy')}</span>
                        <span className="shrink-0 text-sm tabular-nums text-muted">
                          {c.lengthDays !== undefined ? formatDays(c.lengthDays) : 'Текущий'}
                        </span>
                      </div>
                      {c.periodLengthDays !== undefined && (
                        <p className="mt-0.5 text-sm text-muted">
                          Менструация: {formatDays(c.periodLengthDays)}
                        </p>
                      )}
                      {c.excluded && (
                        <p className="mt-0.5 text-sm text-muted">
                          Исключён из статистики{c.excludeReasonLabel ? ` — ${c.excludeReasonLabel}` : ''}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {report.stats.n > 0 && (
              <section>
                <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Статистика периода</h2>
                <div className="card divide-y divide-hairline px-4">
                  <Row label="Завершённых циклов" value={String(report.stats.n)} />
                  {report.stats.medianLength !== undefined && (
                    <Row label="Медианная длина" value={formatDays(report.stats.medianLength)} />
                  )}
                  {report.stats.shortestLength !== undefined && report.stats.longestLength !== undefined && (
                    <Row
                      label="Мин. и макс. длина"
                      value={`${report.stats.shortestLength} и ${formatDays(report.stats.longestLength)}`}
                    />
                  )}
                  {report.stats.spread !== undefined && (
                    <Row label="Размах" value={formatDays(report.stats.spread)} />
                  )}
                </div>
              </section>
            )}

            {report.symptomFrequency.length > 0 && (
              <section>
                <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Симптомы</h2>
                <div className="card divide-y divide-hairline px-4">
                  {report.symptomFrequency.map((s) => (
                    <Row key={s.key} label={s.label} value={plur(s.days, ['день', 'дня', 'дней'])} />
                  ))}
                </div>
              </section>
            )}

            <section>
              <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Кровотечение по дням</h2>
              <div className="card divide-y divide-hairline px-4">
                {report.bleedingDays.map((b) => (
                  <Row key={b.level} label={b.label} value={plur(b.days, ['день', 'дня', 'дней'])} />
                ))}
              </div>
            </section>

            {report.episodes.length > 0 && (
              <section>
                <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Эпизоды</h2>
                <div className="card divide-y divide-hairline px-4">
                  {report.episodes.map((e, i) => (
                    <div key={`${e.kind}-${e.startDate}-${i}`} className="py-3">
                      <p className="font-medium">{e.label}</p>
                      <p className="mt-0.5 text-sm text-muted">
                        {formatRu(e.startDate, 'd MMMM yyyy')} —{' '}
                        {e.endDate ? formatRu(e.endDate, 'd MMMM yyyy') : 'продолжается'}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {report.anomalies.length > 0 && (
              <section>
                <h2 className="mb-1.5 px-1 text-sm font-semibold text-muted">Стоит обратить внимание</h2>
                <div className="card divide-y divide-hairline px-4">
                  {report.anomalies.map((a) => (
                    <div key={a.kind} className="py-3">
                      <p className="font-medium">{a.title}</p>
                      <p className="mt-0.5 text-sm leading-snug text-muted">{a.detail}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Дисклеймер — часть отчёта, печатается вместе с остальным
                содержимым: врач должен видеть его на бумаге, а не только на
                экране перед печатью. */}
            <p className="px-1 text-xs leading-snug text-muted">
              Составлено по отметкам в приложении. Приложение ничего не измеряет и не ставит диагнозов.
            </p>
          </div>

          <div className="print:hidden space-y-2">
            <Button className="w-full" onClick={() => window.print()}>
              <Printer size={18} className="-mt-0.5 mr-1 inline" strokeWidth={2} />
              Распечатать или сохранить в PDF
            </Button>
            <p className="px-1 text-xs leading-snug text-muted">
              Распечатка и сохранённый файл не защищены замком раздела.
            </p>
          </div>
        </div>
      )}
    </Screen>
  );
}
