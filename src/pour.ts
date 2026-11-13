import RAPIER from '@dimforge/rapier2d-compat'
import type { Collider, World } from '@dimforge/rapier2d-compat'
import { add, convexHull, polygonArea, randomBetween, rotate } from './geometry.ts'
import type { Vec } from './geometry.ts'
import type { RockField, RockLook } from './rocks.ts'
import type { Skin } from './skins.ts'
import { MAX_ROCKS, POUR_FLOW_DEFAULT } from './tuning.ts'

type Grade = { minSize: number; maxSize: number; areaShare: number; corners: [number, number] }

const GRADES: Grade[] = [
  { minSize: 1.5, maxSize: 3.0, areaShare: 0.2, corners: [7, 10] },
  { minSize: 0.4, maxSize: 1.1, areaShare: 0.4, corners: [6, 9] },
  { minSize: 0.2, maxSize: 0.36, areaShare: 0.4, corners: [5, 7] },
]

const POUR_ZONE = { left: -6.8, right: 6.8, bottom: 16.6, top: 21.6 }
const MAX_BUDGET = 4
const PLACEMENT_TRIES = 12
const THROW_SPREAD = 3.5
const LEVEL_COLUMNS = [-4.5, -3.5, -2.5, -1.5, 1.5, 2.5, 3.5, 4.5]
const FULL_LEVEL = POUR_ZONE.bottom - 0.4
const REFILL_LEVEL = POUR_ZONE.bottom - 2
const SETTLED_SPEED = 2
const AUTO_FEED_HEIGHT = 20
const LEVEL_CHECK_SECONDS = 0.25
const THROW_TILT = 0.5

function pickGrade(): Grade {
  let roll = Math.random()
  for (const grade of GRADES) {
    roll -= grade.areaShare
    if (roll <= 0) {
      return grade
    }
  }
  return GRADES[GRADES.length - 1]
}

function randomLook(): RockLook {
  return {
    hue: randomBetween(18, 42),
    saturation: randomBetween(4, 14),
    lightness: randomBetween(34, 54),
  }
}

export function randomRockShape(size: number, corners: [number, number]): Vec[] {
  const count = Math.round(randomBetween(corners[0], corners[1]))
  const aspect = randomBetween(0.6, 1)
  const tilt = randomBetween(0, Math.PI)
  const points: Vec[] = []
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + randomBetween(-0.25, 0.25)
    const radius = (size / 2) * randomBetween(0.75, 1)
    points.push(rotate({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius * aspect }, tilt))
  }
  return convexHull(points)
}

type Throw = { skin: Skin; x: number | null }

type Pending = { shape: Vec[]; size: number }

export class Pourer {
  world: World
  rocks: RockField
  target: Vec | null = null
  flow = POUR_FLOW_DEFAULT
  budget = 0
  pouredArea = 0
  pending: Pending | null = null
  autoFeed = false
  private feeding = false
  private levelCheckIn = 0
  private lowestColumn = 0
  private throws: Throw[] = []

  constructor(world: World, rocks: RockField) {
    this.world = world
    this.rocks = rocks
  }

  throwIn(skin: Skin, x: number | null = null) {
    this.throws.push({ skin, x })
  }

  update(dt: number) {
    this.placeThrow()
    let target = this.target
    if (!target) {
      target = this.autoFeedTarget(dt)
    }
    if (!target) {
      this.budget = 0
      return
    }
    this.budget = Math.min(MAX_BUDGET, this.budget + this.flow * dt)
    for (let attempt = 0; attempt < 6 && this.budget > 0; attempt++) {
      if (this.rocks.count >= MAX_ROCKS) {
        return
      }
      const next = this.nextPending()
      const placed = this.tryPlace(next, target)
      if (!placed) {
        return
      }
      this.budget -= polygonArea(next.shape)
      this.pending = null
    }
  }

  private nextPending(): Pending {
    if (this.pending) {
      return this.pending
    }
    const grade = pickGrade()
    const size = randomBetween(grade.minSize, grade.maxSize)
    this.pending = { shape: randomRockShape(size, grade.corners), size }
    return this.pending
  }

  private tryPlace(pending: Pending, target: Vec): boolean {
    for (let attempt = 0; attempt < PLACEMENT_TRIES; attempt++) {
      const center = this.randomSpot(pending, target)
      if (this.isFree(center, pending.size) && this.hasOpenSky(center)) {
        this.spawn(pending, center)
        return true
      }
    }
    return false
  }

  private randomSpot(pending: Pending, target: Vec): Vec {
    const spread = 0.6 + pending.size * 0.5 + this.flow * 0.08
    return {
      x: clamp(target.x + randomBetween(-spread, spread), POUR_ZONE.left, POUR_ZONE.right),
      y: clamp(target.y + randomBetween(0, pending.size + 1), POUR_ZONE.bottom, POUR_ZONE.top),
    }
  }

  private hasOpenSky(center: Vec): boolean {
    const upward = new RAPIER.Ray(center, { x: 0, y: 1 })
    return this.world.castRay(upward, POUR_ZONE.top + 2 - center.y, true) === null
  }

  private autoFeedTarget(dt: number): Vec | null {
    if (!this.autoFeed) {
      this.feeding = false
      return null
    }
    this.levelCheckIn -= dt
    if (this.levelCheckIn <= 0) {
      this.levelCheckIn = LEVEL_CHECK_SECONDS
      this.checkHopperLevel()
    }
    if (!this.feeding) {
      return null
    }
    return { x: this.lowestColumn, y: AUTO_FEED_HEIGHT }
  }

  private checkHopperLevel() {
    let total = 0
    let lowestLevel = Infinity
    for (const x of LEVEL_COLUMNS) {
      const level = this.pileLevelAt(x)
      total += level
      if (level < lowestLevel) {
        lowestLevel = level
        this.lowestColumn = x
      }
    }
    const averageLevel = total / LEVEL_COLUMNS.length
    if (averageLevel < REFILL_LEVEL) {
      this.feeding = true
    }
    if (averageLevel >= FULL_LEVEL) {
      this.feeding = false
    }
  }

  private pileLevelAt(x: number): number {
    const downward = new RAPIER.Ray({ x, y: POUR_ZONE.top }, { x: 0, y: -1 })
    const hit = this.world.castRay(downward, POUR_ZONE.top, true, undefined, undefined, undefined, undefined, isSettled)
    if (!hit) {
      return 0
    }
    return POUR_ZONE.top - hit.timeOfImpact
  }

  private placeThrow() {
    const next = this.throws[0]
    if (!next || this.rocks.count >= MAX_ROCKS) {
      return
    }
    const { width, height } = next.skin
    for (let attempt = 0; attempt < PLACEMENT_TRIES; attempt++) {
      const center = { x: this.throwX(next.x), y: POUR_ZONE.top - height / 2 }
      if (this.isFree(center, Math.hypot(width, height)) && this.hasOpenSky(center)) {
        this.spawnSlab(next.skin, center)
        this.throws.shift()
        return
      }
    }
  }

  private throwX(wanted: number | null): number {
    if (wanted === null) {
      return randomBetween(-THROW_SPREAD, THROW_SPREAD)
    }
    return clamp(wanted + randomBetween(-0.5, 0.5), -THROW_SPREAD, THROW_SPREAD)
  }

  private spawnSlab(skin: Skin, center: Vec) {
    const tilt = randomBetween(-THROW_TILT, THROW_TILT)
    const corners = [
      { x: -skin.width / 2, y: skin.height / 2 },
      { x: skin.width / 2, y: skin.height / 2 },
      { x: skin.width / 2, y: -skin.height / 2 },
      { x: -skin.width / 2, y: -skin.height / 2 },
    ].map((corner) => add(rotate(corner, tilt), center))
    const motion = { velocity: { x: randomBetween(-1, 1), y: -3 }, angularVelocity: randomBetween(-1.5, 1.5) }
    const texture = { anchor: corners[0], angle: tilt }
    const rock = this.rocks.add(corners, motion, randomLook(), 0, texture, skin)
    if (rock) {
      this.pouredArea += rock.area
    }
  }

  private isFree(center: Vec, size: number): boolean {
    let blocked = false
    this.world.intersectionsWithShape(center, 0, new RAPIER.Ball(size / 2), () => {
      blocked = true
      return false
    })
    return !blocked
  }

  private spawn(pending: Pending, center: Vec) {
    const shape = pending.shape.map((p) => ({ x: p.x + center.x, y: p.y + center.y }))
    const motion = { velocity: { x: randomBetween(-0.3, 0.3), y: -2 }, angularVelocity: randomBetween(-1, 1) }
    const texture = { anchor: { x: randomBetween(-50, 50), y: randomBetween(-50, 50) }, angle: randomBetween(0, Math.PI * 2) }
    const rock = this.rocks.add(shape, motion, randomLook(), 0, texture)
    if (rock) {
      this.pouredArea += rock.area
    }
  }
}

function isSettled(collider: Collider): boolean {
  const body = collider.parent()
  if (!body) {
    return true
  }
  const velocity = body.linvel()
  return Math.hypot(velocity.x, velocity.y) < SETTLED_SPEED
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
