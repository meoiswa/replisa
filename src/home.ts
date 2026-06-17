import { go } from './router'

const GAMES = [
  {
    id: 'cats',
    title: 'Cat Queens',
    icon: '🐱',
    description: 'Place cats in every row, column & color region without conflicts.',
    color: 'var(--accent-light)',
  },
]

export function renderHome(): void {
  const app = document.getElementById('app')!
  app.innerHTML = `
    <header class="home-header">
      <h1 class="home-title">Replisa</h1>
      <button class="theme-btn" id="themeBtn" aria-label="Toggle dark mode">🌙</button>
    </header>
    <main class="home-main">
      <div class="games-grid">
        ${GAMES.map(g => `
          <button class="game-card" data-game="${g.id}" style="--card-color:${g.color}">
            <span class="game-icon">${g.icon}</span>
            <span class="game-name">${g.title}</span>
            <span class="game-desc">${g.description}</span>
          </button>
        `).join('')}
      </div>
    </main>
    <footer class="home-footer">
      <a href="https://github.com/meoiswa/replisa" target="_blank" rel="noopener">GitHub</a>
    </footer>
  `

  document.getElementById('themeBtn')!.addEventListener('click', () => {
    const html = document.documentElement
    const next = html.dataset.theme === 'dark' ? 'light' : 'dark'
    html.dataset.theme = next
    localStorage.setItem('theme', next)
  })

  app.querySelectorAll<HTMLButtonElement>('.game-card').forEach(card => {
    card.addEventListener('click', () => go(card.dataset.game!))
  })
}
