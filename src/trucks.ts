import RAPIER from '@dimforge/rapier2d-compat'
import type { Collider, RigidBody, World } from '@dimforge/rapier2d-compat'
import type { Vec } from './geometry.ts'
import { GROUND_Y } from './machine.ts'
import {
  STEEL_FRICTION,
  TRUCK_BRAKE_RESPONSE,
  TRUCK_BRAKING,
  TRUCK_CAPACITY,
  TRUCK_CRUISE_SPEED,
  TRUCK_DESPAWN_X,
  TRUCK_EMPTY_TONNES,
  TRUCK_FOLLOW_GAP,
  TRUCK_PAYLOAD_TONNES,
  TRUCK_PITCH_PER_ACCELERATION,
  TRUCK_POWER_KW,
  TRUCK_RIMPULL_KN,
  TRUCK_ROLLING_RESISTANCE,
  TRUCK_SAG,
  TRUCK_SPAWN_X,
  TRUCK_SUSPENSION_DAMPING,
  TRUCK_SUSPENSION_HZ,
  TRUCK_TOP_SPEED,
  TRUCK_TORQUE_RESPONSE,
} from './tuning.ts'

export const DOCK_X = 0

export const TRUCK = {
  rimY: 4.2,
  floorY: 2.3,
  wheelRadius: 1.35,
  wheels: [{ x: -1.0, y: 1.35 }, { x: 4.4, y: 1.35 }],
  pitchPivot: { x: 1.7, y: 1.35 },
  stackTop: { x: 5.75, y: 4.85 },
  beacon: { x: 4.3, y: 4.6 },
  heapHeight: 0.8,
  bounds: { left: -3.9, right: 6.1, bottom: 0, top: 4.9 },
}

export const BED_INTERIOR: Vec[] = [
  { x: -3.4, y: TRUCK.rimY },
  { x: -2.8, y: TRUCK.floorY },
  { x: 2.9, y: TRUCK.floorY },
  { x: 3.2, y: TRUCK.rimY },
]

export const TRUCK_COLLIDER_PARTS: Vec[][] = [
  [{ x: -2.9, y: 2.05 }, { x: 3.1, y: 2.05 }, { x: 3.1, y: 2.3 }, { x: -2.9, y: 2.3 }],
  [{ x: -2.8, y: 2.3 }, { x: -3.4, y: 4.2 }, { x: -3.75, y: 4.3 }, { x: -3.15, y: 2.05 }],
  [{ x: 2.9, y: 2.3 }, { x: 3.2, y: 4.2 }, { x: 3.5, y: 4.45 }, { x: 3.2, y: 2.05 }],
  [{ x: 3.2, y: 4.25 }, { x: 5.6, y: 4.25 }, { x: 5.6, y: 4.5 }, { x: 3.4, y: 4.55 }],
  [{ x: 3.6, y: 2.3 }, { x: 5.3, y: 2.3 }, { x: 5.3, y: 4.25 }, { x: 3.6, y: 4.25 }],
  [{ x: 5.3, y: 1.5 }, { x: 6.0, y: 1.5 }, { x: 6.0, y: 3.1 }, { x: 5.3, y: 3.4 }],
  [{ x: -3.2, y: 1.45 }, { x: 5.6, y: 1.45 }, { x: 5.6, y: 2.05 }, { x: -3.2, y: 2.05 }],
]

const FULL_HEAP: Vec[] = [
  { x: -3.3, y: TRUCK.rimY },
  { x: 3.1, y: TRUCK.rimY },
  { x: 1.3, y: TRUCK.rimY + TRUCK.heapHeight },
  { x: -1.5, y: TRUCK.rimY + TRUCK.heapHeight },
]

const CATCH_MARGIN = 0.3
const DOCKED_DISTANCE = 1.5
const DOCKED_SPEED = 0.05
const VISIBLE_HEAP_FROM = 0.35

export type TruckState = 'arriving' | 'loading' | 'departing'

function insideConvex(polygon: Vec[], point: Vec): boolean {
  let sign = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    const side = Math.sign((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x))
    if (side === 0) {
      continue
    }
    if (sign === 0) {
      sign = side
    }
    if (side !== sign) {
      return false
    }
  }
  return true
}

const CATCH_ZONE: Vec[] = BED_INTERIOR.map((p) => {
  if (p.y === TRUCK.rimY) {
    return { x: p.x, y: p.y + CATCH_MARGIN }
  }
  return p
})

function convexCollider(shape: Vec[]) {
  const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(shape.flatMap((p) => [p.x, p.y])))
  if (!desc) {
    throw new Error('Truck part is not convex')
  }
  return desc.setFriction(STEEL_FRICTION)
}

export class Truck {
  body: RigidBody
  x: number
  velocity: number
  acceleration = 0
  state: TruckState
  load = 0
  pitch = 0
  wheelTurn = 0
  throttle = 0
  exhaustDue = 0
  private pitchVelocity = 0
  private heap: Collider | null = null
  private world: World

  constructor(world: World, x: number, state: TruckState, velocity: number) {
    this.world = world
    this.x = x
    this.state = state
    this.velocity = velocity
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, GROUND_Y))
    for (const part of TRUCK_COLLIDER_PARTS) {
      world.createCollider(convexCollider(part), this.body)
    }
  }

  get fill(): number {
    return this.load / TRUCK_CAPACITY
  }

  get full(): boolean {
    return this.load >= TRUCK_CAPACITY
  }

  get sag(): number {
    return -TRUCK_SAG * this.fill
  }

  get visibleHeap(): number {
    if (this.full) {
      return TRUCK.heapHeight
    }
    return TRUCK.heapHeight * Math.max(0, (this.fill - VISIBLE_HEAP_FROM) / (1 - VISIBLE_HEAP_FROM))
  }

  toLocal(point: Vec): Vec {
    return { x: point.x - this.x, y: point.y - GROUND_Y - this.sag }
  }

  inBed(point: Vec): boolean {
    return insideConvex(BED_INTERIOR, this.toLocal(point))
  }

  catches(point: Vec): boolean {
    return !this.full && insideConvex(CATCH_ZONE, this.toLocal(point))
  }

  contains(point: Vec): boolean {
    const local = this.toLocal(point)
    const { left, right, bottom, top } = TRUCK.bounds
    return local.x >= left && local.x <= right && local.y >= bottom && local.y <= top
  }

  addLoad(volume: number) {
    if (this.full) {
      return
    }
    this.load = Math.min(TRUCK_CAPACITY, this.load + volume)
    if (this.full) {
      this.heap = this.world.createCollider(convexCollider(FULL_HEAP), this.body)
    }
  }

  depart() {
    this.state = 'departing'
  }

  update(dt: number, leaderX: number | null) {
    const command = this.commandedAcceleration(leaderX)
    let response = TRUCK_TORQUE_RESPONSE
    if (command < this.acceleration) {
      response = TRUCK_BRAKE_RESPONSE
    }
    this.acceleration += (command - this.acceleration) * (1 - Math.exp(-dt / response))
    this.velocity = Math.max(0, Math.min(TRUCK_TOP_SPEED, this.velocity + this.acceleration * dt))
    this.x += this.velocity * dt
    this.settleAtDock()
    this.wheelTurn -= (this.velocity * dt) / TRUCK.wheelRadius
    this.updateSuspension(dt)
    this.body.setNextKinematicTranslation({ x: this.x, y: GROUND_Y + this.sag })
  }

  get gone(): boolean {
    return this.x > TRUCK_DESPAWN_X
  }

  free() {
    this.world.removeRigidBody(this.body)
  }

  private mass(): number {
    return TRUCK_EMPTY_TONNES + TRUCK_PAYLOAD_TONNES * this.fill
  }

  private drivingAcceleration(): number {
    const mass = this.mass()
    const byPower = TRUCK_POWER_KW / (mass * Math.max(0.8, this.velocity))
    const byTraction = TRUCK_RIMPULL_KN / mass
    return Math.min(byPower, byTraction)
  }

  private commandedAcceleration(leaderX: number | null): number {
    if (this.state === 'loading') {
      this.throttle = 0
      return 0
    }
    if (this.state === 'departing') {
      const drive = this.drivingAcceleration()
      this.throttle = 1
      return drive - TRUCK_ROLLING_RESISTANCE
    }
    let stopAt = DOCK_X
    if (leaderX !== null) {
      stopAt = Math.min(stopAt, leaderX - TRUCK_FOLLOW_GAP)
    }
    const reactionDistance = this.velocity * TRUCK_BRAKE_RESPONSE
    const distance = Math.max(0, stopAt - this.x - reactionDistance)
    const safeSpeed = Math.min(TRUCK_CRUISE_SPEED, Math.sqrt(2 * TRUCK_BRAKING * distance))
    const wanted = (safeSpeed - this.velocity) / 0.8
    const drive = this.drivingAcceleration() - TRUCK_ROLLING_RESISTANCE
    this.throttle = Math.max(0, Math.min(1, wanted / Math.max(0.01, drive)))
    return Math.max(-TRUCK_BRAKING * 1.5, Math.min(drive, wanted))
  }

  private settleAtDock() {
    if (this.state !== 'arriving') {
      return
    }
    const nearDock = Math.abs(DOCK_X - this.x) < DOCKED_DISTANCE
    if (nearDock && this.velocity < DOCKED_SPEED) {
      this.velocity = 0
      this.state = 'loading'
    }
  }

  private updateSuspension(dt: number) {
    const target = this.acceleration * TRUCK_PITCH_PER_ACCELERATION
    const omega = 2 * Math.PI * TRUCK_SUSPENSION_HZ
    const spring = omega * omega * (target - this.pitch)
    const damping = 2 * TRUCK_SUSPENSION_DAMPING * omega * this.pitchVelocity
    this.pitchVelocity += (spring - damping) * dt
    this.pitch += this.pitchVelocity * dt
  }
}

export class TruckYard {
  trucks: Truck[] = []
  private world: World

  constructor(world: World) {
    this.world = world
    this.trucks.push(new Truck(world, DOCK_X, 'loading', 0))
  }

  get docked(): Truck | null {
    return this.trucks.find((truck) => truck.state === 'loading') ?? null
  }

  update(dt: number) {
    const ordered = [...this.trucks].sort((a, b) => b.x - a.x)
    let leaderX: number | null = null
    for (const truck of ordered) {
      truck.update(dt, leaderX)
      leaderX = truck.x
    }
    for (const truck of this.trucks.filter((candidate) => candidate.gone)) {
      truck.free()
    }
    this.trucks = this.trucks.filter((truck) => !truck.gone)
  }

  swallows(point: Vec): boolean {
    return this.trucks.some((truck) => truck.inBed(point))
  }

  catcher(point: Vec): Truck | null {
    return this.trucks.find((truck) => truck.catches(point)) ?? null
  }

  parkedAt(point: Vec): Truck | null {
    return this.trucks.find((truck) => truck.state === 'loading' && truck.contains(point)) ?? null
  }

  dispatch(point: Vec): boolean {
    const truck = this.parkedAt(point)
    if (!truck) {
      return false
    }
    truck.depart()
    this.trucks.push(new Truck(this.world, TRUCK_SPAWN_X, 'arriving', TRUCK_CRUISE_SPEED))
    return true
  }
}
