import { mulberry32, shuffle } from './rng'

export interface Level {
  size: number
  regions: number[][]   // regions[row][col] = regionId (0-indexed)
  solution: number[]    // solution[row] = column of cat
  levelNum: number
}

const MAX_PLACEMENT_ATTEMPTS = 80
const MAX_REGION_ATTEMPTS = 180

/** Fibonacci-based grid size: 4 at level 1, +1 at each Fibonacci breakpoint */
export function getGridSize(level: number): number {
  const breakpoints = [2, 3, 5, 8, 13, 21, 34, 55, 89]
  let size = 4
  for (const bp of breakpoints) {
    if (level >= bp) size++
    else break
  }
  return Math.min(size, 12)
}

/** Deterministic seed for a level */
function levelSeed(level: number): number {
  // Simple hash to spread values
  let h = level * 0x9e3779b9
  h = ((h ^ (h >>> 16)) * 0x85ebca6b) >>> 0
  h = ((h ^ (h >>> 13)) * 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/** Find a valid cat placement via backtracking (seeded order) */
function generatePlacement(size: number, rng: () => number): number[] {
  // Pre-shuffle column try-order for each row to get varied solutions
  const tryOrder: number[][] = Array.from({ length: size }, () =>
    shuffle(Array.from({ length: size }, (_, i) => i), rng)
  )

  const placement = new Array<number>(size).fill(-1)
  const usedCols = new Set<number>()

  function solve(row: number): boolean {
    if (row === size) return true
    for (const col of tryOrder[row]) {
      if (usedCols.has(col)) continue
      // Adjacency: consecutive rows can't be in adjacent columns
      if (row > 0 && Math.abs(placement[row - 1] - col) <= 1) continue
      placement[row] = col
      usedCols.add(col)
      if (solve(row + 1)) return true
      placement[row] = -1
      usedCols.delete(col)
    }
    return false
  }

  if (!solve(0)) throw new Error(`No placement for size ${size}`)
  return placement
}

/** Generate connected color regions via randomized flood-fill */
function generateRegions(size: number, placement: number[], rng: () => number): number[][] {
  const regions: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(-1))

  // Seed each region with its cat cell
  for (let row = 0; row < size; row++) {
    regions[row][placement[row]] = row
  }

  const dirs: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]

  // Build initial frontier
  const frontier: [number, number, number][] = [] // [row, col, regionId]
  for (let row = 0; row < size; row++) {
    const col = placement[row]
    for (const [dr, dc] of dirs) {
      const nr = row + dr, nc = col + dc
      if (nr >= 0 && nr < size && nc >= 0 && nc < size && regions[nr][nc] === -1) {
        frontier.push([nr, nc, row])
      }
    }
  }

  while (frontier.length > 0) {
    // Pick random element from frontier
    const idx = Math.floor(rng() * frontier.length)
    const [row, col, regionId] = frontier[idx]
    frontier.splice(idx, 1)

    if (regions[row][col] !== -1) continue // already assigned

    regions[row][col] = regionId

    for (const [dr, dc] of dirs) {
      const nr = row + dr, nc = col + dc
      if (nr >= 0 && nr < size && nc >= 0 && nc < size && regions[nr][nc] === -1) {
        frontier.push([nr, nc, regionId])
      }
    }
  }

  return regions
}

/** Count valid solutions for a generated board, stopping once limit is reached. */
function countSolutions(size: number, regions: number[][], limit = 2): number {
  const placement = new Array<number>(size).fill(-1)
  const usedCols = new Set<number>()
  const usedRegions = new Set<number>()
  let count = 0

  function solve(row: number): void {
    if (count >= limit) return
    if (row === size) {
      count++
      return
    }

    for (let col = 0; col < size; col++) {
      if (usedCols.has(col)) continue
      const rid = regions[row][col]
      if (usedRegions.has(rid)) continue
      // Non-touching rule: adjacent rows cannot be same or neighboring columns.
      if (row > 0 && Math.abs(placement[row - 1] - col) <= 1) continue

      placement[row] = col
      usedCols.add(col)
      usedRegions.add(rid)

      solve(row + 1)

      usedRegions.delete(rid)
      usedCols.delete(col)
      placement[row] = -1
      if (count >= limit) return
    }
  }

  solve(0)
  return count
}

/** Generate a full level */
export function generateLevel(levelNum: number): Level {
  const size = getGridSize(levelNum)
  const rng = mulberry32(levelSeed(levelNum))

  for (let placementAttempt = 0; placementAttempt < MAX_PLACEMENT_ATTEMPTS; placementAttempt++) {
    const solution = generatePlacement(size, rng)

    for (let regionAttempt = 0; regionAttempt < MAX_REGION_ATTEMPTS; regionAttempt++) {
      const regions = generateRegions(size, solution, rng)
      if (countSolutions(size, regions, 2) === 1) {
        return { size, regions, solution, levelNum }
      }
    }
  }

  throw new Error(`Unable to generate a unique-solution level for level ${levelNum}`)
}
