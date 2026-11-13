import type { Vec } from './geometry.ts'
import { randomBetween } from './geometry.ts'

export type Grain = { x: number; y: number; vx: number; vy: number; age: number; life: number; size: number }
export type Puff = { x: number; y: number; vx: number; vy: number; radius: number; age: number; life: number }
export type Spark = { x: number; y: number; vx: number; vy: number; age: number; life: number }

const MAX_GRAINS = 5000
const MAX_PUFFS = 60
const MAX_SPARKS = 200
const GRAINS_PER_SQUARE_METER = 900

function advance<T extends { age: number; life: number }>(items: T[], dt: number, move: (item: T) => void): T[] {
  for (const item of items) {
    item.age += dt
    move(item)
  }
  return items.filter((item) => item.age < item.life)
}

export class Effects {
  grains: Grain[] = []
  puffs: Puff[] = []
  sparks: Spark[] = []

  dust(at: Vec, area: number, velocity: Vec, spread: number) {
    const count = Math.min(60, Math.max(3, Math.round(area * GRAINS_PER_SQUARE_METER)))
    for (let i = 0; i < count && this.grains.length < MAX_GRAINS; i++) {
      this.grains.push({
        x: at.x + randomBetween(-spread, spread),
        y: at.y + randomBetween(-spread, spread),
        vx: velocity.x + randomBetween(-1.2, 1.2),
        vy: velocity.y + randomBetween(-0.6, 1.4),
        age: 0,
        life: randomBetween(0.8, 2.2),
        size: randomBetween(0.015, 0.05),
      })
    }
  }

  puff(at: Vec, size: number) {
    if (this.puffs.length >= MAX_PUFFS) {
      return
    }
    this.puffs.push({
      x: at.x,
      y: at.y,
      vx: randomBetween(-0.15, 0.15),
      vy: randomBetween(0.05, 0.3),
      radius: Math.max(0.3, size * 0.45),
      age: 0,
      life: randomBetween(1.6, 3),
    })
  }

  spark(at: Vec, away: Vec, count: number) {
    for (let i = 0; i < count && this.sparks.length < MAX_SPARKS; i++) {
      const angle = Math.atan2(away.y, away.x) + randomBetween(-1.1, 1.1)
      const speed = randomBetween(3, 8)
      this.sparks.push({
        x: at.x,
        y: at.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        age: 0,
        life: randomBetween(0.12, 0.35),
      })
    }
  }

  update(dt: number) {
    const drag = Math.exp(-dt * 1.5)
    this.grains = advance(this.grains, dt, (g) => {
      g.vx *= drag
      g.vy = g.vy * drag - 9.81 * 0.6 * dt
      g.x += g.vx * dt
      g.y += g.vy * dt
    })
    this.puffs = advance(this.puffs, dt, (p) => {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.radius += dt * 0.35
    })
    this.sparks = advance(this.sparks, dt, (s) => {
      s.vy -= 9.81 * dt
      s.x += s.vx * dt
      s.y += s.vy * dt
    })
  }
}
