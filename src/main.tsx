import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import { claimChunkReload } from './lib/chunkReload'
import './styles/global.css'
import './styles/ui.css'
import './styles/console.css'
import './styles/console-accounts.css'
import './styles/console-operator.css'
import './styles/console-partner-enterprise.css'
import './styles/product-detail.css'
import './styles/enterprise-storefront.css'
import './styles/checkout.css'
import './styles/account.css'
import './styles/account-screens.css'
import './styles/account-view.css'
import './styles/enquiries.css'
import './styles/bundles.css'
import './styles/pricebooks.css'
import './styles/design-system.css'

/* A screen's code that fails to load is most often a deploy that renamed the
   files under an open tab; one reload picks up the new names. Guarded so a
   dead connection gets the error boundary's message rather than a reload
   loop: when the guard says no, the error goes on to that boundary. */
window.addEventListener('vite:preloadError', (event) => {
  let store: Storage | null = null
  try { store = window.sessionStorage } catch { store = null }
  if (claimChunkReload(store, Date.now())) {
    event.preventDefault()
    window.location.reload()
  }
})

/* The design reference page is a standalone surface: no auth, no data, not in
   any navigation. The app has no URL router (each surface is state in App), so
   the one path that is not the app is recognised here, before App mounts. */
const DesignSystemPage = lazy(() => import('./components/DesignSystemPage').then(m => ({ default: m.DesignSystemPage })))
const isDesignSystem = window.location.pathname.replace(/\/+$/, '') === '/design-system'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isDesignSystem
      ? <Suspense fallback={null}><DesignSystemPage /></Suspense>
      : <App />}
  </StrictMode>,
)
