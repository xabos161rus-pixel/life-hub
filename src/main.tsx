import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ensureSettings } from './db/db'
import { ensurePushRegistered } from './lib/push'

ensureSettings()

// Данные живут только локально — просим браузер не вычищать хранилище.
if (navigator.storage?.persist) {
  navigator.storage.persist()
}

// Само-восстановление push-подписки: если уведомления уже разрешены, тихо
// до-регистрируем устройство в списке рассылки об обновлениях (на случай, если
// включали на старой версии — иначе пуш «вышло обновление» не доходит).
void ensurePushRegistered()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
