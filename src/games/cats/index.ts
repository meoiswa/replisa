import './style.css'
import { generateLevel } from './generator'
import { createGameState, placeCat, toggleCross, useHint, hintsAvailable, updateHintTimer, msUntilNextHint } from './game'
import type { GameState } from './game'
import { mulberry32, shuffle } from './rng'
import { go } from '../../router'

type Mode = 'cat' | 'cross'

const REGION_COLORS = ['r0','r1','r2','r3','r4','r5','r6','r7','r8','r9','r10','r11']
const CAT_EMOJIS = ['🐱', '🐈', '🐈‍⬛', '😺', '😸', '😻', '😼', '😽', '🙀']

let state: GameState | null = null
let mode: Mode = 'cat'
let rowEmojis: string[] = []
let hintCell: [number, number] | null = null
let hintToastTimeout: ReturnType<typeof setTimeout> | null = null
let timerInterval: ReturnType<typeof setInterval> | null = null

export function renderCatsGame(levelNum: number): void {
  if (timerInterval) clearInterval(timerInterval)
  const level = generateLevel(levelNum)
  state = createGameState(level)
  mode = 'cat'
  hintCell = null
  const emojiRng = mulberry32(levelNum ^ 0xca7face5)
  const pass1 = shuffle([...CAT_EMOJIS], emojiRng)
  const pass2 = shuffle([...CAT_EMOJIS], emojiRng)
  rowEmojis = [...pass1, ...pass2].slice(0, level.size)
  render()
  timerInterval = setInterval(() => {
    if (!state) return
    const changed = updateHintTimer(state)
    if (changed) updateHintBtn()
    updateHintTimer_display()
  }, 1000)
}

function render(): void {
  if (!state) return
  const app = document.getElementById('app')!
  const s = state

  app.innerHTML = `
    <div class="cats-game">
      <header class="cats-header">
        <button class="back-btn" id="backBtn">←</button>
        <span class="cats-title">Cat Queens</span>
        <button class="theme-btn" id="themeBtn" aria-label="Toggle dark mode">🌙</button>
      </header>
      <div class="cats-info">
        <span>Level ${s.levelNum} · ${s.size}×${s.size}</span>
        <span class="misses-badge">❌ ${s.misses} miss${s.misses !== 1 ? 'es' : ''}</span>
      </div>
      <div class="level-nav">
        <button id="prevBtn">◀</button>
        <span>Level ${s.levelNum}</span>
        <button id="nextBtn">▶</button>
      </div>
      <div class="cats-board-wrap">
        <div class="cats-board" id="board" style="grid-template-columns: repeat(${s.size}, 1fr);">
          ${renderCells(s)}
        </div>
      </div>
      <div class="cats-controls">
        <button class="mode-btn ${mode === 'cat' ? 'active' : ''}" id="catModeBtn">🐱 Cat</button>
        <button class="mode-btn ${mode === 'cross' ? 'active' : ''}" id="crossModeBtn">✕ Cross</button>
        <button class="hint-btn" id="hintBtn" ${hintsAvailable(s) <= 0 ? 'disabled' : ''}>
          <span id="hintCount">💡 ${hintsAvailable(s)}</span><span id="hintTimer" style="font-size:0.7em;display:block;"></span>
        </button>
      </div>
    </div>
  `

  updateHintTimer_display()
  bindEvents()
}

function renderCells(s: GameState): string {
  let html = ''
  for (let row = 0; row < s.size; row++) {
    for (let col = 0; col < s.size; col++) {
      const rid = s.regions[row][col]
      const cell = s.board[row][col]
      const isHint = hintCell && hintCell[0] === row && hintCell[1] === col
      html += `<div class="cell ${cell} ${isHint ? 'hint-highlight' : ''}"
        style="background:var(--${REGION_COLORS[rid % REGION_COLORS.length]})"
        data-row="${row}" data-col="${col}" data-emoji="${rowEmojis[row] ?? '🐱'}"></div>`
    }
  }
  return html
}

function updateHintBtn(): void {
  if (!state) return
  const btn = document.getElementById('hintBtn') as HTMLButtonElement | null
  if (!btn) return
  const avail = hintsAvailable(state)
  btn.disabled = avail <= 0
  const countEl = document.getElementById('hintCount')
  if (countEl) countEl.textContent = `💡 ${avail}`
  const timerEl = document.getElementById('hintTimer')
  if (timerEl && avail <= 0) {
    const ms = msUntilNextHint(state)
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`
  } else if (timerEl) {
    timerEl.textContent = ''
  }
}

function updateHintTimer_display(): void {
  if (!state) return
  const timerEl = document.getElementById('hintTimer')
  if (!timerEl) return
  if (hintsAvailable(state) <= 0) {
    const ms = msUntilNextHint(state)
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    timerEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`
  } else {
    timerEl.textContent = ''
  }
}

function bindEvents(): void {
  document.getElementById('backBtn')?.addEventListener('click', () => {
    if (timerInterval) clearInterval(timerInterval)
    go('')
  })

  document.getElementById('themeBtn')?.addEventListener('click', () => {
    const html = document.documentElement
    const next = html.dataset.theme === 'dark' ? '' : 'dark'
    html.dataset.theme = next
    localStorage.setItem('theme', next)
  })

  document.getElementById('catModeBtn')?.addEventListener('click', () => setMode('cat'))
  document.getElementById('crossModeBtn')?.addEventListener('click', () => setMode('cross'))

  document.getElementById('hintBtn')?.addEventListener('click', () => {
    if (!state) return
    const hint = useHint(state)
    if (!hint) return
    hintCell = [hint.row, hint.col]
    redrawBoard()
    updateHintBtn()
    showToast(`💡 ${hint.reason}`)
    setTimeout(() => {
      hintCell = null
      redrawBoard()
    }, 3000)
  })

  document.getElementById('prevBtn')?.addEventListener('click', () => {
    if (state && state.levelNum > 1) renderCatsGame(state.levelNum - 1)
  })

  document.getElementById('nextBtn')?.addEventListener('click', () => {
    if (state) renderCatsGame(state.levelNum + 1)
  })

  const board = document.getElementById('board')!
  board.addEventListener('click', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.cell')
    if (!cell || !state || state.solved) return
    const row = parseInt(cell.dataset.row!)
    const col = parseInt(cell.dataset.col!)
    handleCellClick(row, col)
  })
}

function setMode(m: Mode): void {
  mode = m
  document.getElementById('catModeBtn')?.classList.toggle('active', m === 'cat')
  document.getElementById('crossModeBtn')?.classList.toggle('active', m === 'cross')
}

function handleCellClick(row: number, col: number): void {
  if (!state) return
  if (mode === 'cross') {
    toggleCross(state, row, col)
    redrawBoard()
    return
  }
  const result = placeCat(state, row, col)
  if (result.miss) {
    flashMiss(row, col)
    updateMisses()
    return
  }
  redrawBoard()
  if (result.solved) showWin()
}

function redrawBoard(): void {
  if (!state) return
  const board = document.getElementById('board')
  if (!board) return
  board.innerHTML = renderCells(state)
}

function updateMisses(): void {
  if (!state) return
  const badge = document.querySelector('.misses-badge')
  if (badge) badge.textContent = `❌ ${state.misses} miss${state.misses !== 1 ? 'es' : ''}`
}

function flashMiss(row: number, col: number): void {
  const cell = document.querySelector<HTMLElement>(`.cell[data-row="${row}"][data-col="${col}"]`)
  if (!cell) return
  cell.style.animation = 'none'
  cell.style.background = '#ff6b6b'
  setTimeout(() => {
    if (state) cell.style.background = `var(--${REGION_COLORS[state.regions[row][col] % REGION_COLORS.length]})`
  }, 400)
}

function showToast(msg: string): void {
  if (hintToastTimeout) clearTimeout(hintToastTimeout)
  document.querySelector('.hint-toast')?.remove()
  const toast = document.createElement('div')
  toast.className = 'hint-toast'
  toast.textContent = msg
  document.body.appendChild(toast)
  hintToastTimeout = setTimeout(() => toast.remove(), 4000)
}

function showWin(): void {
  if (!state) return
  const overlay = document.createElement('div')
  overlay.className = 'win-overlay'
  const nextLevel = state.levelNum + 1
  overlay.innerHTML = `
    <div class="win-card">
      <h2>🎉 You win!</h2>
      <p>${state.misses === 0 ? 'Perfect – no misses!' : `${state.misses} miss${state.misses !== 1 ? 'es' : ''}`}</p>
      <button class="next-btn" id="nextLevelBtn">Next Level →</button>
    </div>
  `
  document.body.appendChild(overlay)
  document.getElementById('nextLevelBtn')?.addEventListener('click', () => {
    overlay.remove()
    renderCatsGame(nextLevel)
  })
}
