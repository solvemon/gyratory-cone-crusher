import type { Vec } from './geometry.ts'
import { randomBetween } from './geometry.ts'
import { GROUND_Y, MANTLE_PARTS, PIVOT, STATIC_PARTS } from './machine.ts'
import { GRAVITY } from './tuning.ts'

const CELL = 0.08
const NEAR = 1
const GRAIN_RADIUS = 0.03
const LAYER_THICKNESS = 0.28
const MAX_GRAINS = 7000
const GRAINS_PER_SQUARE_METER = 550
const MAX_GRAINS_PER_BURST = 120
const AIR_DRAG = 0.3
const BOUNCE = 0.05
const SLIDE_FRICTION = 0.12
const RESTING_SPEED = 0.15
const RESTING_LIFETIME = 1.5
const MAX_AGE = 14
const MAX_STEP = 0.15
const SHADES = 3

type Bounds = { left: number; right: number; bottom: number; top: number }

export type Landing = (x: number, y: number, volume: number) => boolean

function segmentDistance(p: Vec, a: Vec, b: Vec): number {
  const abx = b.x - a.x
  const aby = b.y - a.y
  const along = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby)))
  return Math.hypot(p.x - (a.x + abx * along), p.y - (a.y + aby * along))
}

function signedDistance(polygon: Vec[], p: Vec): number {
  let nearest = Infinity
  let sign = 0
  let inside = true
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    nearest = Math.min(nearest, segmentDistance(p, a, b))
    const side = Math.sign((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x))
    if (side !== 0 && sign === 0) {
      sign = side
    }
    if (side !== 0 && side !== sign) {
      inside = false
    }
  }
  if (inside) {
    return -nearest
  }
  return nearest
}

function boundsOf(polygons: Vec[][], margin: number): Bounds {
  const points = polygons.flat()
  return {
    left: Math.min(...points.map((p) => p.x)) - margin,
    right: Math.max(...points.map((p) => p.x)) + margin,
    bottom: Math.min(...points.map((p) => p.y)) - margin,
    top: Math.max(...points.map((p) => p.y)) + margin,
  }
}

class DistanceGrid {
  private left: number
  private bottom: number
  private columns: number
  private rows: number
  private distances: Float32Array

  constructor(polygons: Vec[][]) {
    const bounds = boundsOf(polygons, NEAR)
    this.left = bounds.left
    this.bottom = bounds.bottom
    this.columns = Math.ceil((bounds.right - bounds.left) / CELL) + 1
    this.rows = Math.ceil((bounds.top - bounds.bottom) / CELL) + 1
    this.distances = new Float32Array(this.columns * this.rows)
    const boxes = polygons.map((polygon) => boundsOf([polygon], NEAR))
    for (let row = 0; row < this.rows; row++) {
      for (let column = 0; column < this.columns; column++) {
        const point = { x: this.left + column * CELL, y: this.bottom + row * CELL }
        let distance = NEAR
        for (let i = 0; i < polygons.length; i++) {
          const box = boxes[i]
          const nearBox = point.x > box.left && point.x < box.right && point.y > box.bottom && point.y < box.top
          if (nearBox) {
            distance = Math.min(distance, signedDistance(polygons[i], point))
          }
        }
        this.distances[row * this.columns + column] = distance
      }
    }
  }

  sample(x: number, y: number): number {
    const gx = (x - this.left) / CELL
    const gy = (y - this.bottom) / CELL
    const column = Math.floor(gx)
    const row = Math.floor(gy)
    if (column < 0 || row < 0 || column >= this.columns - 1 || row >= this.rows - 1) {
      return NEAR
    }
    const fx = gx - column
    const fy = gy - row
    const index = row * this.columns + column
    const below = this.distances[index] * (1 - fx) + this.distances[index + 1] * fx
    const above = this.distances[index + this.columns] * (1 - fx) + this.distances[index + this.columns + 1] * fx
    return below * (1 - fy) + above * fy
  }

  normal(x: number, y: number): Vec {
    const dx = this.sample(x + CELL, y) - this.sample(x - CELL, y)
    const dy = this.sample(x, y + CELL) - this.sample(x, y - CELL)
    const length = Math.hypot(dx, dy) || 1
    return { x: dx / length, y: dy / length }
  }
}

let frameGrid: DistanceGrid | null = null
let mantleGrid: DistanceGrid | null = null

function grids(): [DistanceGrid, DistanceGrid] {
  if (!frameGrid || !mantleGrid) {
    frameGrid = new DistanceGrid(STATIC_PARTS)
    mantleGrid = new DistanceGrid(MANTLE_PARTS.map((part) => part.map((p) => ({ x: p.x - PIVOT.x, y: p.y - PIVOT.y }))))
  }
  return [frameGrid, mantleGrid]
}

export class SandField {
  count = 0
  x = new Float32Array(MAX_GRAINS)
  y = new Float32Array(MAX_GRAINS)
  size = new Float32Array(MAX_GRAINS)
  shade = new Uint8Array(MAX_GRAINS)
  private reach = new Float32Array(MAX_GRAINS)
  private vx = new Float32Array(MAX_GRAINS)
  private vy = new Float32Array(MAX_GRAINS)
  private volume = new Float32Array(MAX_GRAINS)
  private age = new Float32Array(MAX_GRAINS)
  private resting = new Float32Array(MAX_GRAINS)
  detail = 1
  private unplacedVolume = 0
  private frame: DistanceGrid
  private mantle: DistanceGrid

  constructor() {
    const [frame, mantle] = grids()
    this.frame = frame
    this.mantle = mantle
  }

  spawn(at: Vec, area: number, velocity: Vec, spread: number, volume: number) {
    const expected = area * GRAINS_PER_SQUARE_METER * this.detail
    const wanted = Math.min(MAX_GRAINS_PER_BURST, Math.floor(expected + Math.random()))
    const room = MAX_GRAINS - this.count
    const placed = Math.min(wanted, room)
    if (placed === 0) {
      this.unplacedVolume += volume
      return
    }
    const share = (volume + this.unplacedVolume) / placed
    this.unplacedVolume = 0
    for (let i = 0; i < placed; i++) {
      const index = this.count++
      this.x[index] = at.x + randomBetween(-spread, spread)
      this.y[index] = at.y + randomBetween(-spread, spread)
      this.vx[index] = velocity.x + randomBetween(-0.5, 0.5)
      this.vy[index] = velocity.y + randomBetween(-0.3, 0.6)
      this.size[index] = randomBetween(0.03, 0.08) / Math.sqrt(this.detail)
      this.shade[index] = Math.floor(Math.random() * SHADES)
      this.reach[index] = GRAIN_RADIUS + (LAYER_THICKNESS - GRAIN_RADIUS) * Math.random() ** 2
      this.volume[index] = share
      this.age[index] = 0
      this.resting[index] = 0
    }
  }

  update(dt: number, mantleAngle: number, landing: Landing, landingBelow: number) {
    const drag = Math.exp(-dt * AIR_DRAG)
    const cos = Math.cos(mantleAngle)
    const sin = Math.sin(mantleAngle)
    let i = 0
    while (i < this.count) {
      this.vy[i] = (this.vy[i] + GRAVITY * dt) * drag
      this.vx[i] *= drag
      const speed = Math.hypot(this.vx[i], this.vy[i])
      const substeps = Math.max(1, Math.ceil((speed * dt) / MAX_STEP))
      for (let step = 0; step < substeps; step++) {
        this.x[i] += (this.vx[i] * dt) / substeps
        this.y[i] += (this.vy[i] * dt) / substeps
        this.collideWithFrame(i)
        this.collideWithMantle(i, cos, sin)
      }
      this.age[i] += dt
      if (speed < RESTING_SPEED) {
        this.resting[i] += dt
      }
      if (speed >= RESTING_SPEED) {
        this.resting[i] = 0
      }
      if (this.isFinished(i, landing, landingBelow)) {
        this.removeAt(i)
        continue
      }
      i++
    }
  }

  private isFinished(i: number, landing: Landing, landingBelow: number): boolean {
    if (this.y[i] < GROUND_Y || this.age[i] > MAX_AGE || this.resting[i] > RESTING_LIFETIME) {
      return true
    }
    if (this.y[i] > landingBelow || this.vy[i] > 0) {
      return false
    }
    return landing(this.x[i], this.y[i], this.volume[i])
  }

  private collideWithFrame(i: number) {
    const distance = this.frame.sample(this.x[i], this.y[i])
    if (distance >= this.reach[i]) {
      return
    }
    const normal = this.frame.normal(this.x[i], this.y[i])
    this.x[i] += normal.x * (this.reach[i] - distance)
    this.y[i] += normal.y * (this.reach[i] - distance)
    this.slide(i, normal)
  }

  private collideWithMantle(i: number, cos: number, sin: number) {
    const rx = this.x[i] - PIVOT.x
    const ry = this.y[i] - PIVOT.y
    const localX = rx * cos + ry * sin
    const localY = -rx * sin + ry * cos
    const distance = this.mantle.sample(localX, localY)
    if (distance >= this.reach[i]) {
      return
    }
    const local = this.mantle.normal(localX, localY)
    const normal = { x: local.x * cos - local.y * sin, y: local.x * sin + local.y * cos }
    this.x[i] += normal.x * (this.reach[i] - distance)
    this.y[i] += normal.y * (this.reach[i] - distance)
    this.slide(i, normal)
  }

  private slide(i: number, normal: Vec) {
    const into = this.vx[i] * normal.x + this.vy[i] * normal.y
    if (into >= 0) {
      return
    }
    this.vx[i] -= normal.x * into * (1 + BOUNCE)
    this.vy[i] -= normal.y * into * (1 + BOUNCE)
    this.vx[i] *= 1 - SLIDE_FRICTION
    this.vy[i] *= 1 - SLIDE_FRICTION
  }

  private removeAt(i: number) {
    const last = --this.count
    this.x[i] = this.x[last]
    this.y[i] = this.y[last]
    this.vx[i] = this.vx[last]
    this.vy[i] = this.vy[last]
    this.size[i] = this.size[last]
    this.shade[i] = this.shade[last]
    this.volume[i] = this.volume[last]
    this.age[i] = this.age[last]
    this.resting[i] = this.resting[last]
    this.reach[i] = this.reach[last]
  }
}
