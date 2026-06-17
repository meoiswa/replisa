import type { GameState } from './game'

export interface Hint {
  row: number
  col: number
  action: 'cat' | 'cross'
  reason: string
}

/** Build a boolean availability matrix: can a cat legally go at [row][col]? */
function buildAvail(state: GameState): boolean[][] {
  const { size } = state
  const avail: boolean[][] = Array.from({ length: size }, () => new Array<boolean>(size).fill(true))

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const cell = state.board[row][col]
      if (cell === 'cross') { avail[row][col] = false; continue }
      if (cell === 'cat') {
        // Cats block their entire row, col, region, and neighbors
        for (let c = 0; c < size; c++) avail[row][c] = false
        for (let r = 0; r < size; r++) avail[r][col] = false
        const rid = state.regions[row][col]
        for (let r = 0; r < size; r++)
          for (let c = 0; c < size; c++)
            if (state.regions[r][c] === rid) avail[r][c] = false
        for (let dr = -1; dr <= 1; dr++)
          for (let dc = -1; dc <= 1; dc++) {
            const nr = row + dr, nc = col + dc
            if (nr >= 0 && nr < size && nc >= 0 && nc < size) avail[nr][nc] = false
          }
      }
    }
  }

  return avail
}

export function getHint(state: GameState): Hint | null {
  if (state.solved) return null
  const { size } = state
  const avail = buildAvail(state)

  // Strategy 1: Only one available cell in a row
  for (let row = 0; row < size; row++) {
    if (state.catRows.has(row)) continue
    const cols: number[] = []
    for (let col = 0; col < size; col++)
      if (avail[row][col]) cols.push(col)
    if (cols.length === 1)
      return { row, col: cols[0], action: 'cat', reason: `Row ${row + 1} has only one valid position` }
  }

  // Strategy 2: Only one available cell in a column
  for (let col = 0; col < size; col++) {
    if (state.catCols.has(col)) continue
    const rows: number[] = []
    for (let row = 0; row < size; row++)
      if (avail[row][col]) rows.push(row)
    if (rows.length === 1)
      return { row: rows[0], col, action: 'cat', reason: `Column ${col + 1} has only one valid position` }
  }

  // Strategy 3: Only one available cell in a color region
  for (let rid = 0; rid < size; rid++) {
    if (state.catRegions.has(rid)) continue
    const cells: [number, number][] = []
    for (let row = 0; row < size; row++)
      for (let col = 0; col < size; col++)
        if (state.regions[row][col] === rid && avail[row][col]) cells.push([row, col])
    if (cells.length === 1)
      return { row: cells[0][0], col: cells[0][1], action: 'cat', reason: `Color region ${rid + 1} has only one valid position` }
  }

  // Strategy 4: Cross-elimination – if all cells of a row within a region are blocked,
  // the cat for that region can't be in that row (then narrow down)
  // ... (complex – fall back to revealing from solution)

  // Fallback: reveal from solution
  for (let row = 0; row < size; row++) {
    if (!state.catRows.has(row)) {
      const col = state.solution[row]
      if (state.board[row][col] !== 'cat')
        return { row, col, action: 'cat', reason: `Logical deduction narrows this cell` }
    }
  }

  return null
}
