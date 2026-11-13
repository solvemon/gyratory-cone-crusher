import type { Vec } from './geometry.ts'
import { randomBetween } from './geometry.ts'
import { SandField } from './sand.ts'

export type Puff = { x: number; y: number; vx: number; vy: number; radius: number; age: number; life: number }
export type Spark = { x: number; y: number; vx: number; vy: number; age: number; life: number }

const MAX_PUFFS = 60
const MAX_FUMES = 40
const MAX_SPARKS = 200

function advance<T extends { age: number; life: number }>(items: T[], dt: number, move: (item: T) => void): T[] {
  for (const item of items) {
    item.age += dt
    move(item)
  }
  return items.filter((item) => item.age < item.life)
}

export class Effects {
  sand = new SandField()
  puffs: Puff[] = []
  sparks: Spark[] = []
  fumes: Puff[] = []

  dust(at: Vec, area: number, velocity: Vec, spread: number, volume = 0) {
    this.sand.spawn(at, area, velocity, spread, volume)
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

  fume(at: Vec, drift: Vec) {
    if (this.fumes.length >= MAX_FUMES) {
      return
    }
    this.fumes.push({
      x: at.x + randomBetween(-0.05, 0.05),
      y: at.y,
      vx: drift.x + randomBetween(-0.15, 0.15),
      vy: randomBetween(0.6, 1.1),
      radius: randomBetween(0.25, 0.4),
      age: 0,
      life: randomBetween(1.8, 2.8),
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
    this.puffs = advance(this.puffs, dt, (p) => {
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.radius += dt * 0.35
    })
    const fumeDrag = Math.exp(-dt * 0.8)
    this.fumes = advance(this.fumes, dt, (f) => {
      f.vx *= fumeDrag
      f.x += f.vx * dt
      f.y += f.vy * dt
      f.radius += dt * 0.55
    })
    this.sparks = advance(this.sparks, dt, (s) => {
      s.vy -= 9.81 * dt
      s.x += s.vx * dt
      s.y += s.vy * dt
    })
  }
}
