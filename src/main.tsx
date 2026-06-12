import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ensureSettings } from './db/db'

ensureSettings()

// Данные живут только локально — просим браузер не вычищать хранилище.
if (navigator.storage?.persist) {
  navigator.storage.persist()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
