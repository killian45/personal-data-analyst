
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { setLanguage, startLanguage } from './i18n'

// The language is chosen once, before the first screen (sharing plan S3);
// changing it in Settings restarts the app.
setLanguage(startLanguage())

// The service worker is registered by the UpdateBanner component
// (vite-plugin-pwa). Remove the cache used by the previous hand-written
// service worker, which the new one does not clean up by itself.
if ('caches' in window) {
  void caches.delete('personal-data-analyst-v1').catch(() => {})
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
