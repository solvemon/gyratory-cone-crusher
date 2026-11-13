import RAPIER from '@dimforge/rapier2d-compat'
import type { EventQueue, World } from '@dimforge/rapier2d-compat'
import { Breaker } from './breaker.ts'
import { Effects } from './effects.ts'
import { Fracturer } from './fracture.ts'
import { BELT, Machine } from './machine.ts'
import { Pourer } from './pour.ts'
import { RockField } from './rocks.ts'
import type { Rock } from './rocks.ts'
import { BELT_SPEED, CANDIDATE_RATIO, GRAVITY, LOAD_SMOOTHING, SOLVER_ITERATIONS, STEP_DT } from './tuning.ts'

const KILL_ZONE = { left: -14, right: 14.5, bottom: -7, top: 40 }

export async function initPhysics() {
  await RAPIER.init()
}

export class Sim {
  world: World
  events: EventQueue
  machine: Machine
  rocks: RockField
  effects: Effects
  pourer: Pourer
  fracturer: Fracturer
  breaker: Breaker
  timings = { physics: 0, fracture: 0 }

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: GRAVITY })
    this.world.timestep = STEP_DT
    this.world.integrationParameters.numSolverIterations = SOLVER_ITERATIONS
    this.events = new RAPIER.EventQueue(true)
    this.machine = new Machine(this.world)
    this.rocks = new RockField(this.world)
    this.effects = new Effects()
    this.pourer = new Pourer(this.world, this.rocks)
    this.fracturer = new Fracturer(this.rocks, this.effects)
    this.breaker = new Breaker(this.world)
    this.fracturer.toolCollider = this.breaker.collider.handle
  }

  step(dt: number, mantleCatchUp = 1) {
    this.world.timestep = dt
    this.machine.update(dt * mantleCatchUp)
    this.pourer.update(dt)
    this.breaker.update(dt)
    const physicsStart = performance.now()
    this.world.step(this.events)
    this.timings.physics = performance.now() - physicsStart
    const fractureStart = performance.now()
    this.breaker.resolveBlow(this.rocks, this.fracturer)
    this.fracturer.process(this.collectCandidates(), dt)
    this.timings.fracture = performance.now() - fractureStart
    this.updateRocks(dt)
    this.effects.update(dt)
  }

  free() {
    this.events.free()
    this.world.free()
  }

  private collectCandidates(): Set<Rock> {
    const candidates = new Set<Rock>()
    this.events.drainContactForceEvents((event) => {
      const force = event.totalForceMagnitude()
      for (const handle of [event.collider1(), event.collider2()]) {
        const rock = this.rocks.byCollider.get(handle)
        if (rock && force > rock.strength * CANDIDATE_RATIO) {
          candidates.add(rock)
        }
      }
    })
    for (const mantleCollider of this.machine.mantleColliders) {
      this.world.narrowPhase.contactPairsWith(mantleCollider, (handle) => {
        const rock = this.rocks.byCollider.get(handle)
        if (rock) {
          candidates.add(rock)
        }
      })
    }
    return candidates
  }

  private updateRocks(dt: number) {
    const fade = Math.exp(-dt / LOAD_SMOOTHING)
    const expired: Rock[] = []
    for (const rock of this.rocks.byCollider.values()) {
      if (!rock.evaluated) {
        rock.stress *= fade
        rock.chipLoad *= fade
        rock.steelDepth *= fade
      }
      rock.evaluated = false
      rock.chipCooldown -= dt
      const position = rock.body.translation()
      const outside =
        position.x < KILL_ZONE.left ||
        position.x > KILL_ZONE.right ||
        position.y < KILL_ZONE.bottom ||
        position.y > KILL_ZONE.top
      if (outside) {
        expired.push(rock)
        continue
      }
      this.applyBelt(rock, position.x, position.y)
    }
    for (const rock of expired) {
      this.rocks.remove(rock)
    }
  }

  private applyBelt(rock: Rock, x: number, y: number) {
    const restingOnBelt = x > BELT.left && y < BELT.top + rock.size * 0.6 + 0.1
    if (!restingOnBelt) {
      return
    }
    const velocity = rock.body.linvel()
    rock.body.setLinvel({ x: velocity.x + (BELT_SPEED - velocity.x) * 0.15, y: velocity.y }, true)
  }
}
