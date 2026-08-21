import { t } from '../lib/i18n';

/** Экран «данные не открылись».
 *
 *  Весь запуск приложения стоит за открытием IndexedDB, и если оно падает —
 *  откат версии приложения (Dexie бросает VersionError, когда локальная схема
 *  новее кода), переполнение хранилища, повреждение базы на iOS, приватный
 *  режим без IndexedDB — человек видел пустой белый экран. Ни слова о причине,
 *  ни одной кнопки: приложение выглядело сломанным навсегда.
 *
 *  Здесь важно не объяснить причину точно (её и не всегда видно), а не оставить
 *  человека в тупике: назвать, что случилось, и дать хотя бы одно действие.
 *  Стили — инлайновые: таблица стилей на этот момент может быть ещё не
 *  применена, а экран обязан отрисоваться при любом раскладе. */
export function StartupError({ error }: { error: unknown }) {
  const name = (error as { name?: string } | null)?.name ?? '';
  const message = (error as { message?: string } | null)?.message ?? String(error);
  // Локальная база новее кода — почти всегда это откат приложения на прошлую
  // версию (или устройство открыло старую вкладку). Данные при этом целы.
  const isVersion = name === 'VersionError';
  // Хранилище переполнено: чистка кэша помогает, стирать данные не нужно.
  const isQuota = name === 'QuotaExceededError';

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: 24,
        textAlign: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        background: '#0e0e15',
        color: '#f4f4f6',
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>{t('Не удалось открыть данные')}</h1>
      <p style={{ maxWidth: 420, lineHeight: 1.5, opacity: 0.75, margin: 0 }}>
        {isVersion
          ? t('Данные на устройстве новее, чем это приложение. Обновите приложение до последней версии — записи целы.')
          : isQuota
            ? t('На устройстве кончилось место. Освободите память и откройте приложение снова — записи целы.')
            : t('Приложение не смогло открыть хранилище на этом устройстве. Записи, скорее всего, целы — попробуйте перезагрузить.')}
      </p>
      <button
        onClick={() => window.location.reload()}
        style={{
          padding: '12px 24px',
          borderRadius: 999,
          border: 0,
          background: '#5b7cfa',
          color: '#fff',
          fontSize: 16,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {t('Перезагрузить')}
      </button>
      {/* Техническая строка мелким шрифтом: человеку она не нужна, но без неё
          разбираться в чужом сбое приходится вслепую. */}
      <p style={{ fontSize: 12, opacity: 0.4, margin: 0, wordBreak: 'break-word', maxWidth: 420 }}>
        {name ? `${name}: ${message}` : message}
      </p>
    </div>
  );
}
