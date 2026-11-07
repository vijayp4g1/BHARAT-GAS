import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

const UPDATE_CHECK_INTERVAL_MS = 60_000

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    const checkForUpdate = () => {
      registration.update().catch(() => {})
    }
    checkForUpdate()
    window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    })
  },
  onNeedRefresh() {
    // A newer build is ready. Activate it and reload once so a device can never
    // keep running an old bundle after a fix has been deployed.
    void updateSW(true)
  },
})

// When a new service worker takes control, reload exactly once. The app writes
// unsaved bills to the local draft on pagehide/beforeunload, so this is safe.
// The first-ever install (no controller yet) must not reload the page.
let isReloadingForUpdate = false
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller)
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || isReloadingForUpdate) return
    isReloadingForUpdate = true
    window.location.reload()
  })
}

