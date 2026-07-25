import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ensureSettings } from './db/db'
import { ensurePushRegistered } from './lib/push'
import { ensurePersistentStorage } from './lib/storage'

ensureSettings()

// Данные живут только локально — просим браузер не вычищать хранилище.
// Результат читает экран настроек: отказ означает, что Safari сотрёт всё
// после недели без визитов, и человек должен об этом узнать заранее.
void ensurePersistentStorage()

// Само-восстановление push-подписки: если уведомления уже разрешены, тихо
// до-регистрируем устройство в списке рассылки об обновлениях (на случай, если
// включали на старой версии — иначе пуш «вышло обновление» не доходит).
void ensurePushRegistered()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
