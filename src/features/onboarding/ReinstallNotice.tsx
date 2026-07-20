import { useState } from 'react';
import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Share,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { db } from '../../db/db';
import { now } from '../../db/repo';
import { updateSettings } from '../../hooks/useSettings';

/** Адрес сайта для установки — origin + базовый путь сборки (/life-hub/).
 *  Берём из BASE_URL, чтобы ссылка оставалась верной при смене домена. */
const INSTALL_URL = new URL(import.meta.env.BASE_URL || '/', window.location.origin).href;

/**
 * Одноразовое окно о смене имени и значка (Life Hub → LifeHearth).
 *
 * Кому показываем: только тем, кто уже пользовался приложением ДО ребрендинга —
 * onboardingDone стоит, а reinstallNoticeSeen ещё нет. Новым пользователям флаг
 * проставляется вместе с onboardingDone (см. OnboardingOverlay) — они уже
 * поставили новый значок и переустанавливать ничего не нужно.
 *
 * Почему вообще нужно: содержимое приложения обновляется само, но значок и имя
 * на экране «Домой» iOS «запоминает» в момент установки и сам не меняет. Чтобы
 * увидеть новый значок и название — старую иконку надо удалить и поставить
 * заново. Главный риск — при удалении PWA стираются локальные данные, поэтому
 * первым шагом громко просим сохранить копию.
 */
export function ReinstallNotice() {
  const settings = useLiveQuery(() => db.settings.get('app'), []);
  const syncCfg = useLiveQuery(() => db.sync.get('config').then((c) => c ?? null), []);
  const [copied, setCopied] = useState(false);

  // Пока настройки грузятся — не мигаем. Показываем только «старым»
  // пользователям, которые ещё не закрывали это окно.
  if (!settings) return null;
  if (!settings.onboardingDone) return null; // новый пользователь — увидит онбординг
  if (settings.reinstallNoticeSeen) return null;

  const syncOn = Boolean(syncCfg?.enabled);

  const dismiss = () => void updateSettings({ reinstallNoticeSeen: now() });

  const copyLink = () => {
    void navigator.clipboard?.writeText(INSTALL_URL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="fixed inset-0 z-[85] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Закрыть"
        onClick={dismiss}
        className="absolute inset-0 bg-black/55 backdrop-blur-sm"
      />
      <div className="relative m-3 flex max-h-[88dvh] w-full max-w-md animate-fade-in flex-col overflow-hidden rounded-3xl border border-border bg-bg shadow-2xl">
        {/* Шапка */}
        <div className="relative flex items-center gap-3 px-5 pt-5 pb-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <Sparkles size={24} strokeWidth={1.75} />
          </div>
          <div className="min-w-0 pr-7">
            <h2 className="text-lg font-bold leading-tight">Новое имя и значок</h2>
            <p className="text-sm text-muted">Теперь приложение называется LifeHearth</p>
          </div>
          <button
            type="button"
            aria-label="Позже"
            onClick={dismiss}
            className="absolute top-3.5 right-3.5 flex size-8 items-center justify-center rounded-full text-muted active:opacity-60"
          >
            <X size={18} />
          </button>
        </div>

        {/* Прокручиваемое тело */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-2">
          {/* Зачем — коротко */}
          <p className="text-[15px] leading-relaxed">
            У приложения новое название и значок. Внутри всё обновилось само, но на экране
            «Домой» iPhone показывает старую иконку — систему не переубедить, она запоминает
            значок при установке. Чтобы увидеть новый вид — переустановите приложение.
          </p>

          {/* Главное предупреждение — данные */}
          <div className="flex gap-3 rounded-2xl border border-warning/40 bg-warning/10 p-3.5">
            <ShieldAlert size={20} className="mt-0.5 shrink-0 text-warning" />
            <p className="text-sm leading-relaxed">
              <span className="font-semibold">Сначала сохраните данные.</span> При удалении
              приложения задачи, заметки и всё остальное стираются с телефона. Сохраните копию —
              и вернёте всё за минуту, ровно с той же точки.
            </p>
          </div>

          {/* Три шага */}
          <ol className="space-y-3">
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">
                1
              </span>
              <div className="min-w-0 text-sm leading-relaxed">
                <p className="font-semibold">Сохраните данные</p>
                {syncOn ? (
                  <p className="text-muted">
                    Синхронизация включена — копия уже в облаке под вашим ключом. Для надёжности
                    можно ещё выгрузить файл: «Ещё → Настройки → Данные → Экспортировать
                    резервную копию».
                  </p>
                ) : (
                  <p className="text-muted">
                    «Ещё → Настройки → Данные → Экспортировать резервную копию». Файл ляжет в
                    «Файлы» и переживёт удаление приложения.
                  </p>
                )}
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">
                2
              </span>
              <div className="min-w-0 text-sm leading-relaxed">
                <p className="font-semibold">Переустановите</p>
                <p className="text-muted">
                  Удалите старый значок с экрана «Домой». Откройте сайт в Safari, нажмите
                  «Поделиться» → «На экран „Домой“».
                </p>
              </div>
            </li>
            <li className="flex gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent">
                3
              </span>
              <div className="min-w-0 text-sm leading-relaxed">
                <p className="font-semibold">Верните данные</p>
                <p className="text-muted">
                  {syncOn
                    ? 'Откройте приложение и подключите синхронизацию тем же ключом — либо «Импортировать резервную копию». Всё продолжится с той же точки.'
                    : 'Откройте приложение → «Настройки → Данные → Импортировать резервную копию» и выберите сохранённый файл. Всё продолжится с той же точки.'}
                </p>
              </div>
            </li>
          </ol>

          {/* Ссылка на сайт установки — открыть в Safari */}
          <div className="rounded-2xl border border-border bg-surface p-3.5">
            <div className="mb-2 flex items-center gap-2 text-sm text-muted">
              <Share size={16} className="shrink-0" />
              <span>Откройте эту ссылку в Safari:</span>
            </div>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-surface-2 px-2.5 py-2 font-mono text-xs">
                {INSTALL_URL}
              </code>
              <button
                type="button"
                onClick={copyLink}
                aria-label="Скопировать ссылку"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-accent active:opacity-60"
              >
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-muted">
            Не срочно — приложение работает и со старым значком. Это только чтобы обновить имя и
            иконку на экране «Домой».
          </p>

          <Link
            to="/more/settings/install"
            onClick={dismiss}
            className="inline-flex items-center gap-1 text-sm font-semibold text-accent active:opacity-70"
          >
            Подробная инструкция и восстановление данных
            <ChevronRight size={16} />
          </Link>
        </div>

        {/* Кнопки */}
        <div className="flex items-center gap-2 border-t border-hairline p-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
          <button
            type="button"
            onClick={dismiss}
            className="px-3 py-3 text-sm font-medium text-muted active:opacity-60"
          >
            Позже
          </button>
          <a
            href={INSTALL_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-gradient-to-br from-accent to-accent-2 px-5 py-3.5 font-semibold text-white shadow-[0_6px_20px_-9px_var(--app-accent)] active:opacity-90"
          >
            <ExternalLink size={18} />
            Открыть сайт установки
          </a>
        </div>
      </div>
    </div>
  );
}
