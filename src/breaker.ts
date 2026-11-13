import RAPIER from '@dimforge/rapier2d-compat'
import type { Collider, RigidBody, World } from '@dimforge/rapier2d-compat'
import { add, length, normalize, scale, sub } from './geometry.ts'
import type { Vec } from './geometry.ts'
import type { Fracturer } from './fracture.ts'
import type { Rock, RockField } from './rocks.ts'
import { sendShock } from './shock.ts'
import {
  BREAKER_BLOWS_PER_SECOND,
  BREAKER_CHISEL_RETURN_HZ,
  BREAKER_GRIP,
  BREAKER_MAX_FORCE,
  BREAKER_MAX_SPEED,
  BREAKER_PISTON_IMPULSE,
  BREAKER_RESPONSE,
  BREAKER_SHAKE_DECAY,
  BREAKER_STROKE,
} from './tuning.ts'

export const BOOM = {
  pedestal: { x: 10.6, y: 15.4 },
  shoulder: { x: 10.6, y: 16.2 },
  mainBoomLength: 5,
  sleeveLength: 4,
  maxReach: 16.8,
  elbowLift: 2.5,
  park: { x: 7.0, y: 19.4 },
}

export const HOUSING_LENGTH = 1.5

export const HOUSING_SHAPE: Vec[] = [
  { x: 0.22, y: 0.16 },
  { x: 0.4, y: 0.3 },
  { x: HOUSING_LENGTH, y: 0.3 },
  { x: HOUSING_LENGTH, y: -0.3 },
  { x: 0.4, y: -0.3 },
  { x: 0.22, y: -0.16 },
]

export const CHISEL_SHAPE: Vec[] = [
  { x: 0, y: 0 },
  { x: 0.12, y: 0.1 },
  { x: 0.7, y: 0.1 },
  { x: 0.7, y: -0.1 },
  { x: 0.12, y: -0.1 },
]

const HOUSING_MASS = 3
const CHISEL_MASS = 0.6
const CHISEL_PUSH_IN = 0.08
const BLOW_WINDOW_SECONDS = 0.06
const MIN_STRIKE_IMPULSE = 0.3

export type BoomPose = { shoulder: Vec; elbow: Vec; tip: Vec; chisel: Vec; angle: number }

type Hit = { rock: Rock; impulse: number }

function clampToReach(target: Vec): Vec {
  const offset = sub(target, BOOM.shoulder)
  const distance = length(offset)
  if (distance <= BOOM.maxReach) {
    return target
  }
  return add(BOOM.shoulder, scale(normalize(offset), BOOM.maxReach))
}

function solveElbow(tip: Vec): Vec {
  const { shoulder, mainBoomLength, elbowLift } = BOOM
  const aimPoint = { x: (shoulder.x + tip.x) / 2, y: Math.max(shoulder.y, tip.y) + elbowLift }
  return add(shoulder, scale(normalize(sub(aimPoint, shoulder)), mainBoomLength))
}

function convexCollider(shape: Vec[]) {
  const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(shape.flatMap((p) => [p.x, p.y])))
  if (!desc) {
    throw new Error('Breaker shape is not convex')
  }
  return desc
}

function floatingBody(at: Vec) {
  return RAPIER.RigidBodyDesc.dynamic().setTranslation(at.x, at.y).setGravityScale(0).lockRotations().setCanSleep(false)
}

export class Breaker {
  world: World
  body: RigidBody
  collider: Collider
  chisel: RigidBody
  chiselCollider: Collider
  target: Vec | null = null
  hammering = false
  strikes = 0
  shake = 0
  private blowClock = 0
  private blowWindow = 0

  constructor(world: World) {
    this.world = world
    this.body = world.createRigidBody(floatingBody(BOOM.park))
    this.collider = world.createCollider(convexCollider(HOUSING_SHAPE).setFriction(0.6).setMass(HOUSING_MASS), this.body)
    this.chisel = world.createRigidBody(floatingBody(BOOM.park))
    this.chiselCollider = world.createCollider(convexCollider(CHISEL_SHAPE).setFriction(0.6).setMass(CHISEL_MASS), this.chisel)
    const slide = RAPIER.JointData.prismatic({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })
    slide.limitsEnabled = true
    slide.limits = [-BREAKER_STROKE, CHISEL_PUSH_IN]
    const joint = world.createImpulseJoint(slide, this.body, this.chisel, true) as RAPIER.PrismaticImpulseJoint
    joint.setContactsEnabled(false)
    const returnRate = 2 * Math.PI * BREAKER_CHISEL_RETURN_HZ
    joint.configureMotorPosition(0, returnRate * returnRate, 2 * 0.7 * returnRate)
  }

  get toolColliders(): number[] {
    return [this.collider.handle, this.chiselCollider.handle]
  }

  pose(): BoomPose {
    const tip = this.body.translation()
    const elbow = solveElbow(tip)
    const angle = Math.atan2(elbow.y - tip.y, elbow.x - tip.x)
    return { shoulder: BOOM.shoulder, elbow, tip, chisel: this.chisel.translation(), angle }
  }

  update(dt: number) {
    const { tip, angle } = this.pose()
    this.body.setRotation(angle, true)
    this.chisel.setRotation(angle, true)
    this.body.resetForces(true)
    this.body.addForce(this.steeringForce(tip), true)
    this.blowWindow -= dt
    this.shake *= Math.exp(-dt / BREAKER_SHAKE_DECAY)
    if (!this.hammering) {
      this.blowClock = 0
      return
    }
    this.blowClock += dt * BREAKER_BLOWS_PER_SECOND
    if (this.blowClock >= 1) {
      this.blowClock -= 1
      this.firePiston()
    }
  }

  resolveBlow(rocks: RockField, fracturer: Fracturer) {
    if (this.blowWindow <= 0) {
      return
    }
    const hit = this.hardestHit(rocks)
    if (!hit) {
      return
    }
    this.blowWindow = 0
    this.strikes++
    const intensity = Math.min(1.5, hit.impulse / BREAKER_PISTON_IMPULSE)
    const forward = this.forward()
    sendShock(this.world, rocks, fracturer.effects, hit.rock, intensity)
    fracturer.strike(hit.rock, this.chiselCollider.handle, forward, intensity)
  }

  private firePiston() {
    const forward = this.forward()
    this.chisel.applyImpulse(scale(forward, BREAKER_PISTON_IMPULSE), true)
    this.body.applyImpulse(scale(forward, -BREAKER_PISTON_IMPULSE), true)
    this.blowWindow = BLOW_WINDOW_SECONDS
    this.shake = 1
  }

  private forward(): Vec {
    const { elbow, tip } = this.pose()
    return normalize(sub(tip, elbow))
  }

  private hardestHit(rocks: RockField): Hit | null {
    let hardest: Hit | null = null
    const chisel = this.chiselCollider.handle
    this.world.narrowPhase.contactPairsWith(chisel, (handle) => {
      const rock = rocks.byCollider.get(handle)
      if (!rock) {
        return
      }
      const impulse = impulseBetween(this.world, chisel, handle)
      if (impulse < MIN_STRIKE_IMPULSE) {
        return
      }
      if (!hardest || impulse > hardest.impulse) {
        hardest = { rock, impulse }
      }
    })
    return hardest
  }

  private steeringForce(tip: Vec): Vec {
    let goal = BOOM.park
    if (this.target) {
      goal = clampToReach(this.target)
    }
    const desiredVelocity = limit(scale(sub(goal, tip), BREAKER_RESPONSE), BREAKER_MAX_SPEED)
    const correction = sub(desiredVelocity, this.body.linvel())
    return limit(scale(correction, HOUSING_MASS * BREAKER_GRIP), BREAKER_MAX_FORCE)
  }
}

function impulseBetween(world: World, first: number, second: number): number {
  let total = 0
  world.narrowPhase.contactPair(first, second, world.bodies, (manifold) => {
    for (let i = 0; i < manifold.numContacts(); i++) {
      total += manifold.contactImpulse(i)
    }
  })
  return total
}

function limit(vector: Vec, maxLength: number): Vec {
  const magnitude = length(vector)
  if (magnitude <= maxLength) {
    return vector
  }
  return scale(vector, maxLength / magnitude)
}
