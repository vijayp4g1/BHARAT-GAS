import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import toast from 'react-hot-toast'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Check at most every 30 minutes. Do NOT check/reload on every visibility
// change: switching to another app and back must never discard the operator's
// selected delivery boy or scanned bills.
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null
let updatePromptShown = false

const updateSW = registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    const checkForUpdate = () => {
      registration.update().catch(() => {})
    }
    window.setTimeout(checkForUpdate, 30_000)
    window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS)
  },
  onNeedRefresh() {
    if (updatePromptShown) return
    updatePromptShown = true

    toast(
      (t) => (
        <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontWeight: 600 }}>New version ready</span>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(t.id)
              updatePromptShown = false
            }}
            style={{
              background: 'transparent',
              color: '#cbd5e1',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 8,
              padding: '6px 8px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Later
          </button>
          <button
            type="button"
            onClick={() => {
              toast.dismiss(t.id)
              updatePromptShown = false
              void applyUpdate?.(true)
            }}
            style={{
              background: '#f59e0b',
              color: '#0f172a',
              border: 0,
              borderRadius: 8,
              padding: '6px 10px',
              fontWeight: 800,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </span>
      ),
      { duration: Infinity, id: 'sw-update-ready' }
    )
  },
})

applyUpdate = updateSW
