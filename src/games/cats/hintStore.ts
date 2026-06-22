const GLOBAL_HINTS_KEY = 'replisa.hints.v1'
const HINT_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

interface GlobalHintsState {
  earned: number
  used: number
  lastEarnedTime: number
}

function createInitialHints(): GlobalHintsState {
  return { earned: 0, used: 0, lastEarnedTime: Date.now() }
}

function loadGlobalHints(): GlobalHintsState {
  try {
    const raw = localStorage.getItem(GLOBAL_HINTS_KEY)
    if (!raw) {
      const initial = createInitialHints()
      saveGlobalHints(initial)
      return initial
    }
    const parsed = JSON.parse(raw) as Partial<GlobalHintsState>
    return {
      earned: typeof parsed.earned === 'number' ? Math.max(0, parsed.earned) : 0,
      used: typeof parsed.used === 'number' ? Math.max(0, parsed.used) : 0,
      lastEarnedTime: typeof parsed.lastEarnedTime === 'number' ? parsed.lastEarnedTime : Date.now(),
    }
  } catch {
    const initial = createInitialHints()
    saveGlobalHints(initial)
    return initial
  }
}

function saveGlobalHints(s: GlobalHintsState): void {
  localStorage.setItem(GLOBAL_HINTS_KEY, JSON.stringify(s))
}

export function hintsAvailable(): number {
  const s = loadGlobalHints()
  return Math.max(0, s.earned - s.used)
}

export function updateHintTimer(): boolean {
  const s = loadGlobalHints()
  const elapsed = Date.now() - s.lastEarnedTime
  const newHints = Math.floor(elapsed / HINT_INTERVAL_MS)
  if (newHints > 0) {
    s.earned += newHints
    s.lastEarnedTime += newHints * HINT_INTERVAL_MS
    saveGlobalHints(s)
    return true
  }
  return false
}

export function msUntilNextHint(): number {
  const s = loadGlobalHints()
  const elapsed = Date.now() - s.lastEarnedTime
  return Math.max(0, HINT_INTERVAL_MS - elapsed)
}

export function consumeHint(): boolean {
  const s = loadGlobalHints()
  if (s.earned <= s.used) return false
  s.used++
  saveGlobalHints(s)
  return true
}

export function grantHints(count: number): void {
  const s = loadGlobalHints()
  s.earned += Math.max(0, Math.floor(count))
  saveGlobalHints(s)
}
