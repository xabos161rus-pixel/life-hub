import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { db, ensureSettings } from './db/db'
import { resolveLang, setLang } from './lib/i18n'
import { ensurePushRegistered } from './lib/push'
import { ensurePersistentStorage } from './lib/storage'

// Данные живут только локально — просим браузер не вычищать хранилище.
// Результат читает экран настроек: отказ означает, что Safari сотрёт всё
// после недели без визитов, и человек должен об этом узнать заранее.
void ensurePersistentStorage()

// Само-восстановление push-подписки: если уведомления уже разрешены, тихо
// до-регистрируем устройство в списке рассылки об обновлениях (на случай, если
// включали на старой версии — иначе пуш «вышло обновление» не доходит).
void ensurePushRegistered()

// Язык обязан встать ДО первого рендера: строки читаются в момент рендера,
// и «мигание» русского перед английским — это дефект, а не мелочь. Чтение
// настройки из IndexedDB — миллисекунды.
void (async () => {
  await ensureSettings()
  const s = await db.settings.get('app')
  setLang(resolveLang(s?.language))
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})()
