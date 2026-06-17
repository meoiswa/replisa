import type { GameState } from './game'

export interface Hint {
  row: number
  col: number
  action: 'cat' | 'cross'
  reason: string
  cells?: Array<{ row: number; col: number }>
}

const REGION_COLOR_NAMES = [
  'Red',
  'Blue',
  'Green',
  'Yellow',
  'Purple',
  'Orange',
  'Teal',
  'Pink',
  'Lime',
  'Indigo',
  'Gold',
  'Mint',
]

function regionColorName(regionId: number): string {
  return REGION_COLOR_NAMES[regionId % REGION_COLOR_NAMES.length]
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

function blockedByCat(state: GameState, row: number, col: number): Set<string> {
  const { size } = state
  const blocked = new Set<string>()

  for (let c = 0; c < size; c++) {
    if (c !== col) blocked.add(`${row},${c}`)
  }
  for (let r = 0; r < size; r++) {
    if (r !== row) blocked.add(`${r},${col}`)
  }

  const rid = state.regions[row][col]
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (state.regions[r][c] === rid && !(r === row && c === col)) {
        blocked.add(`${r},${c}`)
      }
    }
  }

  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nr = row + dr
      const nc = col + dc
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue
      if (nr === row && nc === col) continue
      blocked.add(`${nr},${nc}`)
    }
  }

  return blocked
}

export function getHint(state: GameState): Hint | null {
  if (state.solved) return null
  const { size } = state
  const avail = buildAvail(state)
  const regionIds = new Set<number>()
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      regionIds.add(state.regions[row][col])
    }
  }

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

  // Strategy 3: If a region is confined to one row or one column, cells in that
  // same line that belong to other regions can be crossed.
  for (const rid of regionIds) {
    if (state.catRegions.has(rid)) continue
    const cells: [number, number][] = []
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (state.regions[row][col] === rid && avail[row][col]) cells.push([row, col])
      }
    }
    if (cells.length < 2) continue

    const rowSet = new Set(cells.map(([row]) => row))
    if (rowSet.size === 1) {
      const onlyRow = cells[0][0]
      const crossTargets: Array<{ row: number; col: number }> = []
      for (let col = 0; col < size; col++) {
        if (state.regions[onlyRow][col] === rid) continue
        if (!avail[onlyRow][col]) continue
        crossTargets.push({ row: onlyRow, col })
      }
      if (crossTargets.length > 0) {
        return {
          row: crossTargets[0].row,
          col: crossTargets[0].col,
          action: 'cross',
          reason: `${regionColorName(rid)} region is confined to row ${onlyRow + 1}; other regions in that row can be crossed`,
          cells: crossTargets,
        }
      }
    }

    const colSet = new Set(cells.map(([, col]) => col))
    if (colSet.size === 1) {
      const onlyCol = cells[0][1]
      const crossTargets: Array<{ row: number; col: number }> = []
      for (let row = 0; row < size; row++) {
        if (state.regions[row][onlyCol] === rid) continue
        if (!avail[row][onlyCol]) continue
        crossTargets.push({ row, col: onlyCol })
      }
      if (crossTargets.length > 0) {
        return {
          row: crossTargets[0].row,
          col: crossTargets[0].col,
          action: 'cross',
          reason: `${regionColorName(rid)} region is confined to column ${onlyCol + 1}; other regions in that column can be crossed`,
          cells: crossTargets,
        }
      }
    }
  }
  
  // Strategy 4: Single-region forced crosses.
  // For one unresolved region, if every possible cat position blocks the same
  // tiles, those tiles are forced crosses.
  for (const rid of regionIds) {
    if (state.catRegions.has(rid)) continue
    const candidates: Array<{ row: number; col: number }> = []
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (state.regions[row][col] === rid && avail[row][col]) {
          candidates.push({ row, col })
        }
      }
    }
    if (candidates.length < 2) continue

    let sharedBlocked = blockedByCat(state, candidates[0].row, candidates[0].col)
    for (let i = 1; i < candidates.length; i++) {
      const blocked = blockedByCat(state, candidates[i].row, candidates[i].col)
      const intersection = new Set<string>()
      for (const key of sharedBlocked) {
        if (blocked.has(key)) intersection.add(key)
      }
      sharedBlocked = intersection
      if (sharedBlocked.size === 0) break
    }

    const forcedCrosses: Array<{ row: number; col: number }> = []
    for (const key of sharedBlocked) {
      const [rowText, colText] = key.split(',')
      const row = Number(rowText)
      const col = Number(colText)
      if (!avail[row][col]) continue
      if (state.board[row][col] !== 'empty') continue
      if (state.regions[row][col] === rid) continue
      forcedCrosses.push({ row, col })
    }

    if (forcedCrosses.length > 0) {
      return {
        row: forcedCrosses[0].row,
        col: forcedCrosses[0].col,
        action: 'cross',
        reason: `Every possible cat position in the ${regionColorName(rid)} region blocks these tiles`,
        cells: forcedCrosses,
      }
    }
  }
  
  // Strategy 5: Only one available cell in a color region
  for (const rid of regionIds) {
    if (state.catRegions.has(rid)) continue
    const emptyCells: [number, number][] = []
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (state.regions[row][col] !== rid) continue
        if (state.board[row][col] !== 'empty') continue
        emptyCells.push([row, col])
      }
    }
    if (emptyCells.length === 1 && avail[emptyCells[0][0]][emptyCells[0][1]])
      return {
        row: emptyCells[0][0],
        col: emptyCells[0][1],
        action: 'cat',
        reason: `${regionColorName(rid)} region has only one valid position`,
      }
  }

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
