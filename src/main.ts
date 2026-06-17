import './style.css'
import { initRouter } from './router'

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = new URL('./', window.location.href).pathname
    navigator.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {})
  })
}

// Apply saved theme
const saved = localStorage.getItem('theme')
document.documentElement.dataset.theme = saved === 'dark' ? 'dark' : 'light'

initRouter()
