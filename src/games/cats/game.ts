import type { Level } from './generator'

export type CellState = 'empty' | 'cross' | 'cat'

export interface GameState {
  size: number
  regions: number[][]
  solution: number[]
  board: CellState[][]
  misses: number
  solved: boolean
  catRows: Set<number>
  catCols: Set<number>
  catRegions: Set<number>
  startTime: number
  levelNum: number
  hash: string
}

export function createGameState(level: Level): GameState {
  return {
    size: level.size,
    regions: level.regions,
    solution: level.solution,
    board: Array.from({ length: level.size }, () => new Array<CellState>(level.size).fill('empty')),
    misses: 0,
    solved: false,
    catRows: new Set(),
    catCols: new Set(),
    catRegions: new Set(),
    startTime: Date.now(),
    levelNum: level.levelNum,
    hash: level.hash,
  }
}

export interface PlaceResult {
  valid: boolean
  miss: boolean
  solved: boolean
}

/** Place a cat at (row, col). Returns whether the move was valid. */
export function placeCat(state: GameState, row: number, col: number): PlaceResult {
  if (state.board[row][col] === 'cat') {
    // Toggle off
    state.board[row][col] = 'empty'
    state.catRows.delete(row)
    state.catCols.delete(col)
    state.catRegions.delete(state.regions[row][col])
    return { valid: true, miss: false, solved: false }
  }

  if (state.board[row][col] === 'cross') {
    return { valid: false, miss: false, solved: false }
  }

  const correct = state.solution[row] === col
  if (!correct) {
    state.misses++
    state.board[row][col] = 'cross'
    return { valid: false, miss: true, solved: false }
  }

  state.board[row][col] = 'cat'
  state.catRows.add(row)
  state.catCols.add(col)
  state.catRegions.add(state.regions[row][col])

  // Auto-cross cells in same row, col, region and neighbors
  for (let c = 0; c < state.size; c++) if (c !== col && state.board[row][c] === 'empty') state.board[row][c] = 'cross'
  for (let r = 0; r < state.size; r++) if (r !== row && state.board[r][col] === 'empty') state.board[r][col] = 'cross'
  const rid = state.regions[row][col]
  for (let r = 0; r < state.size; r++)
    for (let c = 0; c < state.size; c++)
      if (state.regions[r][c] === rid && !(r === row && c === col) && state.board[r][c] === 'empty')
        state.board[r][c] = 'cross'
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      const nr = row + dr, nc = col + dc
      if (nr >= 0 && nr < state.size && nc >= 0 && nc < state.size && !(nr === row && nc === col) && state.board[nr][nc] === 'empty')
        state.board[nr][nc] = 'cross'
    }

  const solved = state.catRows.size === state.size
  state.solved = solved
  return { valid: true, miss: false, solved }
}

export function toggleCross(state: GameState, row: number, col: number): void {
  if (state.board[row][col] === 'cat') return
  state.board[row][col] = state.board[row][col] === 'cross' ? 'empty' : 'cross'
}
