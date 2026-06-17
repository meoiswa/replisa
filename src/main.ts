import './style.css'
import { initRouter } from './router'

// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/replisa/sw.js').catch(() => {})
  })
}

// Apply saved theme
const saved = localStorage.getItem('theme')
if (saved) document.documentElement.dataset.theme = saved

initRouter()
