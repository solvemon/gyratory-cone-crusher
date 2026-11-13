import RAPIER from '@dimforge/rapier2d-compat'
import type { EventQueue, World } from '@dimforge/rapier2d-compat'
import { Breaker } from './breaker.ts'
import { Effects } from './effects.ts'
import { Fracturer } from './fracture.ts'
import { Hum } from './hum.ts'
import { DISCHARGE_Y, GROUND_Y, Machine } from './machine.ts'
import { Pourer } from './pour.ts'
import { RockField } from './rocks.ts'
import type { Rock } from './rocks.ts'
import { TRUCK, TruckYard } from './trucks.ts'
import { BREAKER_SHAKE_DECAY, TRUCK_EXHAUST_PUFFS_PER_SECOND, CANDIDATE_RATIO, GRAVITY, LOAD_SMOOTHING, SOLVER_ITERATIONS, STEP_DT } from './tuning.ts'

const KILL_ZONE = { left: -80, right: 80, bottom: GROUND_Y - 0.5, top: 40 }
const TRUCK_REACH_Y = GROUND_Y + TRUCK.bounds.top + 0.5
const SAND_STEPS_PER_UPDATE = 2
const SAND_DUST_EVERY = 0.6

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
  trucks: TruckYard
  hum = new Hum()
  timings = { physics: 0, fracture: 0 }
  time = 0
  private crushed = 0
  private sandClock = 0
  private sandSteps = 0
  private landedSinceDust = 0

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
    this.fracturer.toolColliders = this.breaker.toolColliders
    this.trucks = new TruckYard(this.world)
  }

  step(dt: number, mantleCatchUp = 1) {
    this.world.timestep = dt
    this.time += dt
    this.machine.update(dt * mantleCatchUp)
    this.pourer.update(dt)
    this.breaker.update(dt)
    this.hum.update(this.world, this.machine, this.rocks, this.fracturer, dt)
    this.trucks.update(dt)
    this.puffExhaust(dt)
    const physicsStart = performance.now()
    this.world.step(this.events)
    this.timings.physics = performance.now() - physicsStart
    const fractureStart = performance.now()
    this.breaker.resolveBlow(this.rocks, this.fracturer)
    this.fracturer.process(this.collectCandidates(), dt)
    this.timings.fracture = performance.now() - fractureStart
    this.updateRocks(dt)
    this.effects.update(dt)
    this.updateSand(dt)
  }

  crushedVolume(): number {
    let held = 0
    for (const rock of this.rocks.byCollider.values()) {
      if (rock.body.translation().y > DISCHARGE_Y) {
        held += rock.area
      }
    }
    this.crushed = Math.max(this.crushed, this.pourer.pouredArea - held)
    return this.crushed
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
    const shakeFade = Math.exp(-dt / BREAKER_SHAKE_DECAY)
    const expired: Rock[] = []
    const loaded: Rock[] = []
    for (const rock of this.rocks.byCollider.values()) {
      if (!rock.evaluated) {
        rock.stress *= fade
        rock.chipLoad *= fade
        rock.steelDepth *= fade
      }
      rock.shake *= shakeFade
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
      if (position.y < TRUCK_REACH_Y && this.loadIntoTruck(rock, position)) {
        loaded.push(rock)
      }
    }
    for (const rock of expired.concat(loaded)) {
      this.rocks.remove(rock)
    }
  }

  private puffExhaust(dt: number) {
    for (const truck of this.trucks.trucks) {
      truck.exhaustDue += truck.throttle * TRUCK_EXHAUST_PUFFS_PER_SECOND * dt
      while (truck.exhaustDue >= 1) {
        truck.exhaustDue -= 1
        const stack = { x: truck.x + TRUCK.stackTop.x, y: GROUND_Y + truck.sag + TRUCK.stackTop.y }
        this.effects.fume(stack, { x: truck.velocity * 0.4, y: 0 })
      }
    }
  }

  private loadIntoTruck(rock: Rock, position: { x: number; y: number }): boolean {
    const truck = this.trucks.catcher(position)
    if (!truck) {
      return false
    }
    truck.addLoad(rock.area)
    const velocity = rock.body.linvel()
    this.effects.puff(position, rock.size * 0.7)
    this.effects.dust(position, rock.area * 0.15, { x: velocity.x * 0.2, y: 1 }, rock.size * 0.4)
    return true
  }

  private updateSand(dt: number) {
    this.sandClock += dt
    this.sandSteps++
    if (this.sandSteps < SAND_STEPS_PER_UPDATE) {
      return
    }
    const elapsed = this.sandClock
    this.sandClock = 0
    this.sandSteps = 0
    this.effects.sand.update(elapsed, this.machine.angle, (x, y, volume) => this.landSand(x, y, volume), TRUCK_REACH_Y)
  }

  private landSand(x: number, y: number, volume: number): boolean {
    const truck = this.trucks.catcher({ x, y })
    if (!truck) {
      return false
    }
    truck.addLoad(volume)
    this.landedSinceDust += volume
    if (this.landedSinceDust > SAND_DUST_EVERY) {
      this.landedSinceDust = 0
      this.effects.puff({ x, y: y + 0.3 }, 1.4)
    }
    return true
  }
}
