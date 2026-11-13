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

// Do not force-reload the page while somebody is typing/pasting into a field.
// The BPCL paste editor is a textarea; reloading it mid-paste made the report
// disappear. A per-boy/date draft is also stored by the modal, but waiting for
// the field to lose focus avoids the disruption entirely.
let pendingSwUpdate = false
let applyPendingUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null

function isTextEntryFocused(): boolean {
  // Modal editors (BPCL paste, live scanner) mark themselves so an automatic
  // app-update reload never interrupts an operator mid-entry.
  if (document.querySelector('[data-bgcls-editing="true"]')) return true

  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function activatePendingSwUpdate() {
  if (!pendingSwUpdate) return
  if (!applyPendingUpdate) {
    window.setTimeout(activatePendingSwUpdate, 300)
    return
  }
  if (isTextEntryFocused()) {
    window.setTimeout(activatePendingSwUpdate, 1500)
    return
  }
  pendingSwUpdate = false
  void applyPendingUpdate(true)
}

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
    // keep running an old bundle after a fix has been deployed — but wait until
    // the operator is not in the middle of typing/pasting.
    pendingSwUpdate = true
    activatePendingSwUpdate()
  },
})

applyPendingUpdate = updateSW

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

