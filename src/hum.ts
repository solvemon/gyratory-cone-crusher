import type { World } from '@dimforge/rapier2d-compat'
import { inwardDirection } from './fracture.ts'
import type { Fracturer } from './fracture.ts'
import { add, scale } from './geometry.ts'
import type { Vec } from './geometry.ts'
import type { Machine } from './machine.ts'
import type { Rock, RockField } from './rocks.ts'
import { HUM_ACCELERATION, HUM_DEPTH, HUM_FALLOFF, HUM_HZ, HUM_STEPS_PER_PASS, WEAR_MIN_THICKNESS, WEAR_RATE } from './tuning.ts'

type Shaking = { rock: Rock; strength: number }
type Contact = { away: Vec; point: Vec; force: number }
type WornSpot = { rock: Rock; point: Vec }

export class Hum {
  private phase = 0
  private pending = 0
  private stepsSincePass = 0

  update(world: World, machine: Machine, rocks: RockField, fracturer: Fracturer, dt: number) {
    this.phase += 2 * Math.PI * HUM_HZ * dt
    this.pending += dt
    this.stepsSincePass++
    if (this.stepsSincePass < HUM_STEPS_PER_PASS) {
      return
    }
    const elapsed = this.pending
    this.pending = 0
    this.stepsSincePass = 0
    if (machine.speed === 0) {
      return
    }
    const pass = new HumPass(world, rocks, machine.speed * HUM_ACCELERATION * Math.sin(this.phase), elapsed)
    let wave: Shaking[] = []
    for (const steel of machine.steelColliders) {
      wave = wave.concat(pass.shakeNeighbours(steel, machine.speed))
    }
    for (let depth = 1; depth < HUM_DEPTH; depth++) {
      let next: Shaking[] = []
      for (const source of wave) {
        next = next.concat(pass.shakeNeighbours(source.rock.collider.handle, source.strength * HUM_FALLOFF))
      }
      wave = next
    }
    for (const spot of pass.wornSpots) {
      if (!rocks.byCollider.has(spot.rock.collider.handle)) {
        continue
      }
      if (fracturer.wearAway(spot.rock, spot.point)) {
        spot.rock.wear = 0
        continue
      }
      spot.rock.wear = 0.5
    }
  }
}

class HumPass {
  wornSpots: WornSpot[] = []
  private reached = new Set<Rock>()
  private world: World
  private rocks: RockField
  private acceleration: number
  private dt: number

  constructor(world: World, rocks: RockField, acceleration: number, dt: number) {
    this.world = world
    this.rocks = rocks
    this.acceleration = acceleration
    this.dt = dt
  }

  shakeNeighbours(source: number, strength: number): Shaking[] {
    const shaken: Shaking[] = []
    this.world.narrowPhase.contactPairsWith(source, (handle) => {
      const rock = this.rocks.byCollider.get(handle)
      if (!rock || this.reached.has(rock)) {
        return
      }
      const contact = contactWith(this.world, source, handle, rock.body.translation())
      if (!contact) {
        return
      }
      this.reached.add(rock)
      rock.body.applyImpulse(scale(contact.away, rock.body.mass() * this.acceleration * strength * this.dt), true)
      this.wear(rock, contact, strength)
      shaken.push({ rock, strength })
    })
    return shaken
  }

  private wear(rock: Rock, contact: Contact, strength: number) {
    if (rock.thickness < WEAR_MIN_THICKNESS) {
      return
    }
    rock.wear += (WEAR_RATE * contact.force * strength * this.dt) / rock.area
    if (rock.wear >= 1) {
      this.wornSpots.push({ rock, point: contact.point })
    }
  }
}

function contactWith(world: World, source: number, rock: number, rockCenter: Vec): Contact | null {
  let found: Contact | null = null
  world.narrowPhase.contactPair(rock, source, world.bodies, (manifold, flipped) => {
    const count = manifold.numSolverContacts()
    if (count === 0) {
      return
    }
    let point = { x: 0, y: 0 }
    for (let i = 0; i < count; i++) {
      const solverPoint = manifold.solverContactPoint(i)
      if (solverPoint) {
        point = add(point, scale(solverPoint, 1 / count))
      }
    }
    let impulse = 0
    for (let i = 0; i < manifold.numContacts(); i++) {
      impulse += manifold.contactImpulse(i)
    }
    found = {
      away: inwardDirection(manifold.normal(), flipped, point, rockCenter),
      point,
      force: Math.max(0, impulse) / world.timestep,
    }
  })
  return found
}
