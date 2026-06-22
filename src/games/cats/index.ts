import './style.css'
import { generateLevel } from './generator'
import type { Level } from './generator'
import { GENERATOR_VERSION } from './generator'
import type { LevelReadyMessage } from './levelWorker'
import { createGameState, placeCat, toggleCross } from './game'
import type { CellState, GameState } from './game'
import * as hintStore from './hintStore'
import { getHint } from './hints'
import { mulberry32, shuffle } from './rng'
import { go } from '../../router'

const REGION_COLORS = ['r0','r1','r2','r3','r4','r5','r6','r7','r8','r9','r10','r11']
const CAT_EMOJIS = ['🐱', '🐈', '🐈‍⬛', '😺', '😸', '😻', '😼', '😽', '🙀']
const CATS_PROGRESS_KEY = 'replisa.cats.progress.v1'
const LEVEL_CACHE_KEY = 'replisa.cats.levels.v1'
const DOUBLE_TAP_MS = 300
const PRE_GENERATE_COUNT = 10

interface StoredCatsLevelState {
  hash: string
  board: CellState[][]
  misses: number
  solved: boolean
  catRows: number[]
  catCols: number[]
  catRegions: number[]
  startTime: number
}

interface StoredCatsProgress {
  currentLevel: number
  clearedLevels: number[]
  levels: Record<string, StoredCatsLevelState>
}

interface CachedLevelData extends Level {
  generatorVersion: number
}

let state: GameState | null = null
let rowEmojis: string[] = []
let hintCell: [number, number] | null = null
let hintToastTimeout: ReturnType<typeof setTimeout> | null = null
let timerInterval: ReturnType<typeof setInterval> | null = null
let hintClickLocked = false
let lastTapTime = 0
let lastTapKey = ''
let tapTimer: ReturnType<typeof setTimeout> | null = null
let currentLevelStale = false
let levelWorker: Worker | null = null

declare global {
  interface Window {
    grantHints?: (count?: number) => void
  }
}

function createEmptyProgress(): StoredCatsProgress {
  return { currentLevel: 1, clearedLevels: [], levels: {} }
}

function loadProgress(): StoredCatsProgress {
  try {
    const raw = localStorage.getItem(CATS_PROGRESS_KEY)
    if (!raw) return createEmptyProgress()
    const parsed = JSON.parse(raw) as Partial<StoredCatsProgress>
    return {
      currentLevel: typeof parsed.currentLevel === 'number' && parsed.currentLevel > 0 ? parsed.currentLevel : 1,
      clearedLevels: Array.isArray(parsed.clearedLevels)
        ? parsed.clearedLevels.filter((v): v is number => typeof v === 'number' && v > 0)
        : [],
      levels: parsed.levels && typeof parsed.levels === 'object' ? parsed.levels : {},
    }
  } catch {
    return createEmptyProgress()
  }
}

function saveProgress(progress: StoredCatsProgress): void {
  localStorage.setItem(CATS_PROGRESS_KEY, JSON.stringify(progress))
}

// ---------------------------------------------------------------------------
// Level data cache – persists generated layouts keyed by level number.
// ---------------------------------------------------------------------------
function loadLevelCache(): Record<string, CachedLevelData> {
  try {
    const raw = localStorage.getItem(LEVEL_CACHE_KEY)
    return raw ? (JSON.parse(raw) as Record<string, CachedLevelData>) : {}
  } catch { return {} }
}

function getCachedLevel(levelNum: number): CachedLevelData | null {
  return loadLevelCache()[String(levelNum)] ?? null
}

function storeCachedLevel(data: CachedLevelData): void {
  const cache = loadLevelCache()
  cache[String(data.levelNum)] = data
  localStorage.setItem(LEVEL_CACHE_KEY, JSON.stringify(cache))
}

function deleteCachedLevel(levelNum: number): void {
  const cache = loadLevelCache()
  delete cache[String(levelNum)]
  localStorage.setItem(LEVEL_CACHE_KEY, JSON.stringify(cache))
}

// ---------------------------------------------------------------------------
// Web Worker – pre-generates upcoming levels in the background.
// ---------------------------------------------------------------------------
function getLevelWorker(): Worker {
  if (!levelWorker) {
    levelWorker = new Worker(new URL('./levelWorker.ts', import.meta.url), { type: 'module' })
    levelWorker.onmessage = (e: MessageEvent<LevelReadyMessage>) => {
      if (e.data?.type === 'LEVEL_READY') storeCachedLevel(e.data.level)
    }
  }
  return levelWorker
}

function requestPreGeneration(fromLevel: number): void {
  const cache = loadLevelCache()
  const needed: number[] = []
  for (let i = 1; i <= PRE_GENERATE_COUNT; i++) {
    const n = fromLevel + i
    const cached = cache[String(n)]
    if (!cached || cached.generatorVersion !== GENERATOR_VERSION) needed.push(n)
  }
  if (needed.length > 0) getLevelWorker().postMessage({ type: 'GENERATE', levelNums: needed })
}

function restoreLevelState(baseState: GameState, stored?: StoredCatsLevelState): GameState {
  if (!stored) return baseState
  if (stored.hash !== baseState.hash) return baseState
  if (!Array.isArray(stored.board) || stored.board.length !== baseState.size) return baseState
  if (!stored.board.every(row => Array.isArray(row) && row.length === baseState.size)) return baseState
  baseState.board = stored.board.map(row => [...row])
  baseState.misses = typeof stored.misses === 'number' ? stored.misses : 0
  baseState.solved = Boolean(stored.solved)
  baseState.catRows = new Set(Array.isArray(stored.catRows) ? stored.catRows : [])
  baseState.catCols = new Set(Array.isArray(stored.catCols) ? stored.catCols : [])
  baseState.catRegions = new Set(Array.isArray(stored.catRegions) ? stored.catRegions : [])
  baseState.startTime = typeof stored.startTime === 'number' ? stored.startTime : baseState.startTime
  return baseState
}

function toStoredLevelState(current: GameState): StoredCatsLevelState {
  return {
    hash: current.hash,
    board: current.board.map(row => [...row]),
    misses: current.misses,
    solved: current.solved,
    catRows: [...current.catRows],
    catCols: [...current.catCols],
    catRegions: [...current.catRegions],
    startTime: current.startTime,
  }
}

function persistCurrentState(): void {
  if (!state) return
  const progress = loadProgress()
  const levelKey = String(state.levelNum)
  progress.currentLevel = state.levelNum
  progress.levels[levelKey] = toStoredLevelState(state)
  if (state.solved && !progress.clearedLevels.includes(state.levelNum)) {
    progress.clearedLevels.push(state.levelNum)
    progress.clearedLevels.sort((a, b) => a - b)
  }
  saveProgress(progress)
}
function resetSavedLevel(levelNum: number): void {
  const progress = loadProgress()
  const levelKey = String(levelNum)
  delete progress.levels[levelKey]
  progress.currentLevel = levelNum
  progress.clearedLevels = progress.clearedLevels.filter(level => level !== levelNum)
  saveProgress(progress)
}

function installDebugConsoleCommands(): void {
  window.grantHints = (count = 1) => {
    const amount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0
    if (amount <= 0) {
      console.warn('Usage: grantHints(1)')
      return
    }
    hintStore.grantHints(amount)
    updateHintBtn()
    updateHintTimer_display()
    console.info(`Granted ${amount} hint${amount === 1 ? '' : 's'}. Available: ${hintStore.hintsAvailable()}`)
  }
}

export function renderCatsGame(levelNum?: number): void {
  if (timerInterval) clearInterval(timerInterval)
  const progress = loadProgress()
  const targetLevel = levelNum ?? progress.currentLevel ?? 1

  // Use cached level if available (even if stale version – stale levels remain
  // playable; a warning is shown on the Reset button). Only generate
  // synchronously when there is no cached copy at all.
  const cached = getCachedLevel(targetLevel)
  let level: Level
  if (cached) {
    level = cached
    currentLevelStale = cached.generatorVersion !== GENERATOR_VERSION
  } else {
    level = generateLevel(targetLevel)
    storeCachedLevel({ ...level, generatorVersion: GENERATOR_VERSION })
    currentLevelStale = false
  }

  state = restoreLevelState(createGameState(level), progress.levels[String(targetLevel)])
  requestPreGeneration(targetLevel)
  hintCell = null
  lastTapTime = 0
  lastTapKey = ''
  if (tapTimer) { clearTimeout(tapTimer); tapTimer = null }
  const emojiRng = mulberry32(targetLevel ^ 0xca7face5)
  const pass1 = shuffle([...CAT_EMOJIS], emojiRng)
  const pass2 = shuffle([...CAT_EMOJIS], emojiRng)
  rowEmojis = [...pass1, ...pass2].slice(0, level.size)
  installDebugConsoleCommands()
  render()
  persistCurrentState()
  timerInterval = setInterval(() => {
    const changed = hintStore.updateHintTimer()
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
          <button class="reset-btn${currentLevelStale ? ' stale' : ''}" id="resetBtn">${currentLevelStale ? '⚠️ ' : ''}↺ Reset</button>
        <button class="hint-btn" id="hintBtn" ${hintStore.hintsAvailable() <= 0 ? 'disabled' : ''}>
          <span id="hintCount">💡 ${hintStore.hintsAvailable()}</span><span id="hintTimer" style="font-size:0.7em;display:block;"></span>
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
  const btn = document.getElementById('hintBtn') as HTMLButtonElement | null
  if (!btn) return
  const avail = hintStore.hintsAvailable()
  btn.disabled = avail <= 0
  const countEl = document.getElementById('hintCount')
  if (countEl) countEl.textContent = `💡 ${avail}`
  const timerEl = document.getElementById('hintTimer')
  if (timerEl) {
    const ms = hintStore.msUntilNextHint()
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    timerEl.textContent = `next ${mins}:${secs.toString().padStart(2, '0')}`
  }
}

function updateHintTimer_display(): void {
  const timerEl = document.getElementById('hintTimer')
  if (!timerEl) return
  const ms = hintStore.msUntilNextHint()
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  timerEl.textContent = `next ${mins}:${secs.toString().padStart(2, '0')}`
}

function bindEvents(): void {
  document.getElementById('backBtn')?.addEventListener('click', () => {
    if (timerInterval) clearInterval(timerInterval)
    persistCurrentState()
    go('')
  })

  document.getElementById('themeBtn')?.addEventListener('click', () => {
    const html = document.documentElement
    const next = html.dataset.theme === 'dark' ? 'light' : 'dark'
    html.dataset.theme = next
    localStorage.setItem('theme', next)
  })

  document.getElementById('resetBtn')?.addEventListener('click', () => {
    if (!state) return
    const msg = currentLevelStale
      ? 'This level was generated by an older algorithm version.\nReset to regenerate it with the latest version?'
      : 'Reset this level and clear current progress?'
    const shouldReset = window.confirm(msg)
    if (!shouldReset) return
    resetSavedLevel(state.levelNum)
    if (currentLevelStale) deleteCachedLevel(state.levelNum)
    renderCatsGame(state.levelNum)
  })

  document.getElementById('hintBtn')?.addEventListener('click', () => {
    if (!state) return
    if (hintClickLocked) return
    if (hintStore.hintsAvailable() <= 0) return
    hintClickLocked = true
    setTimeout(() => { hintClickLocked = false }, 150)
    if (!hintStore.consumeHint()) return
    const hint = getHint(state)
    if (!hint) {
      // Refund – no actionable hint found
      hintStore.grantHints(1)
      return
    }

    if (hint.action === 'cross') {
      const targets = hint.cells && hint.cells.length > 0 ? hint.cells : [{ row: hint.row, col: hint.col }]
      for (const target of targets) {
        if (state.board[target.row][target.col] === 'empty') {
          state.board[target.row][target.col] = 'cross'
        }
      }
      hintCell = [hint.row, hint.col]
      redrawBoard()
      updateHintBtn()
      persistCurrentState()
      showToast(`💡 ${hint.reason}`)
      setTimeout(() => { hintCell = null; redrawBoard() }, 3000)
      return
    }

    hintCell = [hint.row, hint.col]
    redrawBoard()
    updateHintBtn()
    persistCurrentState()
    showToast(`💡 ${hint.reason}`)
    setTimeout(() => { hintCell = null; redrawBoard() }, 3000)
  })

  document.getElementById('prevBtn')?.addEventListener('click', () => {
    if (!state || state.levelNum <= 1) return
    persistCurrentState()
    renderCatsGame(state.levelNum - 1)
  })

  document.getElementById('nextBtn')?.addEventListener('click', () => {
    if (!state) return
    persistCurrentState()
    renderCatsGame(state.levelNum + 1)
  })

  const board = document.getElementById('board')!
  board.addEventListener('click', (e) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('.cell')
    if (!cell || !state || state.solved) return
    const row = parseInt(cell.dataset.row!)
    const col = parseInt(cell.dataset.col!)
    handleCellInteraction(row, col)
  })
}

function handleCellInteraction(row: number, col: number): void {
  if (!state || state.solved) return
  const now = Date.now()
  const key = `${row},${col}`
  if (now - lastTapTime < DOUBLE_TAP_MS && lastTapKey === key) {
    // Double-tap: cancel pending cross, place cat instead
    if (tapTimer) { clearTimeout(tapTimer); tapTimer = null }
    lastTapTime = 0
    lastTapKey = ''
    handleCatPlacement(row, col)
  } else {
    // First tap: schedule a cross after the double-tap window
    lastTapTime = now
    lastTapKey = key
    if (tapTimer) clearTimeout(tapTimer)
    tapTimer = setTimeout(() => {
      tapTimer = null
      if (lastTapKey === key) {
        lastTapKey = ''
        handleCrossToggle(row, col)
      }
    }, DOUBLE_TAP_MS)
  }
}

function handleCatPlacement(row: number, col: number): void {
  if (!state) return
  const result = placeCat(state, row, col)
  if (result.miss) {
    redrawBoard()
    flashMiss(row, col)
    updateMisses()
    persistCurrentState()
    return
  }
  redrawBoard()
  persistCurrentState()
  if (result.solved) showWin()
}

function handleCrossToggle(row: number, col: number): void {
  if (!state) return
  toggleCross(state, row, col)
  redrawBoard()
  persistCurrentState()
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
  persistCurrentState()
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
