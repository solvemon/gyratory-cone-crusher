import RAPIER from '@dimforge/rapier2d-compat'
import type { World } from '@dimforge/rapier2d-compat'
import { convexHull, polygonArea, randomBetween, rotate } from './geometry.ts'
import type { Vec } from './geometry.ts'
import type { RockField, RockLook } from './rocks.ts'
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

type Pending = { shape: Vec[]; size: number }

export class Pourer {
  world: World
  rocks: RockField
  target: Vec | null = null
  flow = POUR_FLOW_DEFAULT
  budget = 0
  pouredArea = 0
  pending: Pending | null = null

  constructor(world: World, rocks: RockField) {
    this.world = world
    this.rocks = rocks
  }

  update(dt: number) {
    if (!this.target) {
      this.budget = 0
      return
    }
    this.budget = Math.min(MAX_BUDGET, this.budget + this.flow * dt)
    for (let attempt = 0; attempt < 6 && this.budget > 0; attempt++) {
      if (this.rocks.count >= MAX_ROCKS) {
        return
      }
      const next = this.nextPending()
      const placed = this.tryPlace(next, this.target)
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
