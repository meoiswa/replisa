import './style.css'
import { initRouter } from './router'

if (import.meta.env.PROD) {
  // Inject manifest link with the correct base URL (only needed in production).
  // In dev, Vite serves public/ files at root / while %BASE_URL% = /replisa/,
  // so the path would be wrong and Chrome would receive index.html instead of JSON.
  const manifestLink = document.createElement('link')
  manifestLink.rel = 'manifest'
  manifestLink.href = `${import.meta.env.BASE_URL}manifest.json`
  document.head.appendChild(manifestLink)

  // Register service worker.
  window.addEventListener('load', () => {
    if ('serviceWorker' in navigator) {
      const base = new URL('./', window.location.href).pathname
      navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {})
    }
  })
} else {
  // Dev: unregister any stale service worker left from a previous session.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then(regs => regs.forEach(r => r.unregister()))
      .catch(() => {})
  }
}

// Apply saved theme
const saved = localStorage.getItem('theme')
document.documentElement.dataset.theme = saved === 'dark' ? 'dark' : 'light'

initRouter()
