import { mulberry32, shuffle } from './rng'

export interface Level {
  size: number
  regions: number[][]   // regions[row][col] = regionId (0-indexed)
  solution: number[]    // solution[row] = column of cat
  levelNum: number
  hash: string          // fingerprint of regions+solution for progress validation
}

/**
 * Increment this whenever the generation algorithm changes in a way that
 * affects level layout or uniqueness. Stored levels with an older version are
 * flagged as stale and the player is offered to regenerate them.
 */
export const GENERATOR_VERSION = 1

function computeLevelHash(size: number, regions: number[][], solution: number[]): string {
  let h = (size * 0x9e3779b9) >>> 0
  for (let r = 0; r < size; r++)
    for (let c = 0; c < size; c++)
      h = (Math.imul(h, 31) + regions[r][c] + 1) >>> 0
  for (const col of solution)
    h = (Math.imul(h, 31) + col + 1) >>> 0
  return h.toString(16).padStart(8, '0')
}

// ---------------------------------------------------------------------------
// Enumerate ALL valid placements for a grid size (row/col/non-touch rules).
// Results are cached per size so the cost is paid only once across all levels.
// ---------------------------------------------------------------------------
const MAX_ENUM = 20_000
const placementsCache = new Map<number, number[][]>()

function getAllPlacements(size: number): number[][] {
  if (placementsCache.has(size)) return placementsCache.get(size)!
  const result: number[][] = []
  const p = new Array<number>(size).fill(-1)
  const usedCols = new Set<number>()

  function enumerate(row: number): void {
    if (result.length >= MAX_ENUM) return
    if (row === size) { result.push([...p]); return }
    for (let col = 0; col < size; col++) {
      if (result.length >= MAX_ENUM) return
      if (usedCols.has(col)) continue
      if (row > 0 && Math.abs(p[row - 1] - col) <= 1) continue
      p[row] = col; usedCols.add(col)
      enumerate(row + 1)
      usedCols.delete(col); p[row] = -1
    }
  }

  enumerate(0)
  placementsCache.set(size, result)
  return result
}

// ---------------------------------------------------------------------------
// Coverage-aware flood-fill.
//
// When growing regions from their seed cells, at every step we preferentially
// assign each frontier cell to whichever adjacent region would create the most
// new "collision" for not-yet-covered alternate placements.
//
// An alternate is "covered" when ≥2 of its cat positions have been assigned
// to the same region ID, making it invalid under the distinct-region rule.
// ---------------------------------------------------------------------------
const DIRS: [number, number][] = [[-1, 0], [1, 0], [0, -1], [0, 1]]

function generateRegionsWithCoverage(
  size: number,
  solution: number[],
  alternates: number[][],
  rng: () => number,
): number[][] {
  const regions: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(-1))
  for (let r = 0; r < size; r++) regions[r][solution[r]] = r

  // altsByCell[r][c] = indices of alternates whose cat is at column c in row r
  const altsByCell: number[][][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => [] as number[]),
  )
  for (let i = 0; i < alternates.length; i++)
    for (let r = 0; r < size; r++)
      altsByCell[r][alternates[i][r]].push(i)

  // For each alternate, track how many times each regionId appears so far
  // among its cells that have been assigned. When any regionId count reaches
  // 2, the alternate is covered (it has a collision).
  const ridCountForAlt: Map<number, number>[] = alternates.map(() => new Map())
  const covered = new Set<number>()

  function recordAssignment(r: number, c: number, rid: number): void {
    for (const ai of altsByCell[r][c]) {
      if (covered.has(ai)) continue
      const n = (ridCountForAlt[ai].get(rid) ?? 0) + 1
      ridCountForAlt[ai].set(rid, n)
      if (n >= 2) covered.add(ai)
    }
  }

  // Initialise: solution cells are already assigned
  for (let r = 0; r < size; r++) recordAssignment(r, solution[r], r)

  // frontier: cellKey(r,c) → Set of adjacent regionIds that can claim (r,c)
  const frontier = new Map<number, Set<number>>()

  function addFrontier(r: number, c: number, rid: number): void {
    if (r < 0 || r >= size || c < 0 || c >= size || regions[r][c] !== -1) return
    const k = r * size + c
    if (!frontier.has(k)) frontier.set(k, new Set())
    frontier.get(k)!.add(rid)
  }

  for (let r = 0; r < size; r++)
    for (const [dr, dc] of DIRS) addFrontier(r + dr, solution[r] + dc, r)

  // Score: how many uncovered alternates would gain their first touch on `rid`
  // (i.e., they already have one cell in `rid` — adding another creates a collision)
  function score(r: number, c: number, rid: number): number {
    let s = 0
    for (const ai of altsByCell[r][c])
      if (!covered.has(ai) && (ridCountForAlt[ai].get(rid) ?? 0) >= 1) s++
    return s
  }

  while (frontier.size > 0) {
    let best = -1
    const top: [number, number][] = [] // [cellKey, rid]
    for (const [k, rids] of frontier) {
      const r = Math.floor(k / size), c = k % size
      for (const rid of rids) {
        const s = score(r, c, rid)
        if (s > best) { best = s; top.length = 0 }
        if (s === best) top.push([k, rid])
      }
    }

    const [k, rid] = top[Math.floor(rng() * top.length)]
    const r = Math.floor(k / size), c = k % size
    regions[r][c] = rid
    recordAssignment(r, c, rid)
    frontier.delete(k)
    for (const [dr, dc] of DIRS) addFrontier(r + dr, c + dc, rid)
  }

  return regions
}



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
  let h = level * 0x9e3779b9
  h = ((h ^ (h >>> 16)) * 0x85ebca6b) >>> 0
  h = ((h ^ (h >>> 13)) * 0xc2b2ae35) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

/** Find a valid cat placement via backtracking (seeded order) */
function generatePlacement(size: number, rng: () => number): number[] {
  const tryOrder: number[][] = Array.from({ length: size }, () =>
    shuffle(Array.from({ length: size }, (_, i) => i), rng)
  )
  const placement = new Array<number>(size).fill(-1)
  const usedCols = new Set<number>()

  function solve(row: number): boolean {
    if (row === size) return true
    for (const col of tryOrder[row]) {
      if (usedCols.has(col)) continue
      if (row > 0 && Math.abs(placement[row - 1] - col) <= 1) continue
      placement[row] = col; usedCols.add(col)
      if (solve(row + 1)) return true
      placement[row] = -1; usedCols.delete(col)
    }
    return false
  }

  if (!solve(0)) throw new Error(`No placement for size ${size}`)
  return placement
}

/** Count valid solutions (stops at limit). Used only as a post-generation check. */
function countSolutions(size: number, regions: number[][], limit = 2): number {
  const placement = new Array<number>(size).fill(-1)
  const usedCols = new Set<number>()
  const usedRegions = new Set<number>()
  let count = 0

  function solve(row: number): void {
    if (count >= limit) return
    if (row === size) { count++; return }
    for (let col = 0; col < size; col++) {
      if (usedCols.has(col)) continue
      const rid = regions[row][col]
      if (usedRegions.has(rid)) continue
      if (row > 0 && Math.abs(placement[row - 1] - col) <= 1) continue
      placement[row] = col; usedCols.add(col); usedRegions.add(rid)
      solve(row + 1)
      usedRegions.delete(rid); usedCols.delete(col); placement[row] = -1
      if (count >= limit) return
    }
  }

  solve(0)
  return count
}

/** Generate a full level with a guaranteed-unique solution wherever possible. */
export function generateLevel(levelNum: number): Level {
  const size = getGridSize(levelNum)

  // Use one seed for the placement, separate seeds per region attempt.
  const solution = generatePlacement(size, mulberry32(levelSeed(levelNum)))

  // Alternates: all valid placements for this grid size except the solution.
  // getAllPlacements is cached per size, so the enumeration cost is paid once.
  const solutionStr = solution.join(',')
  const alternates = getAllPlacements(size).filter(p => p.join(',') !== solutionStr)

  // Try up to 5 region seeds. The coverage-aware fill usually succeeds on the
  // first or second attempt; retries guard against edge-case configurations.
  for (let attempt = 0; attempt < 5; attempt++) {
    const regionRng = mulberry32(levelSeed(levelNum) ^ (attempt * 0x6c62272e))
    const regions = generateRegionsWithCoverage(size, solution, alternates, regionRng)
    if (countSolutions(size, regions, 2) === 1)
      return { size, regions, solution, levelNum, hash: computeLevelHash(size, regions, solution) }
  }

  // Fallback: return the last attempt even if not unique.
  console.warn(`Level ${levelNum}: returning best-effort level (unique solution not found in 5 attempts)`)
  const fallbackRng = mulberry32(levelSeed(levelNum) ^ 0xdeadbeef)
  const regions = generateRegionsWithCoverage(size, solution, alternates, fallbackRng)
  return { size, regions, solution, levelNum, hash: computeLevelHash(size, regions, solution) }
}
