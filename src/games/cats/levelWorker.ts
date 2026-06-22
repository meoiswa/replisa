/// <reference lib="webworker" />
import { generateLevel, GENERATOR_VERSION } from './generator'
import type { Level } from './generator'

export interface WorkerRequest {
  type: 'GENERATE'
  levelNums: number[]
}

export interface LevelReadyMessage {
  type: 'LEVEL_READY'
  level: Level & { generatorVersion: number }
}

// Queue of level numbers waiting to be generated
let queue: number[] = []
let running = false

function pump(): void {
  if (running || queue.length === 0) return
  running = true
  const levelNum = queue.shift()!
  const level = generateLevel(levelNum)
  const msg: LevelReadyMessage = {
    type: 'LEVEL_READY',
    level: { ...level, generatorVersion: GENERATOR_VERSION },
  }
  self.postMessage(msg)
  running = false
  // Yield between levels so new GENERATE messages can arrive and re-prioritise
  if (queue.length > 0) setTimeout(pump, 0)
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  if (event.data.type !== 'GENERATE') return
  // Append any level numbers not already queued
  for (const n of event.data.levelNums) {
    if (!queue.includes(n)) queue.push(n)
  }
  pump()
}
