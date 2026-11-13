import RAPIER from '@dimforge/rapier2d-compat'
import type { Collider, RigidBody, World } from '@dimforge/rapier2d-compat'
import { add, length, normalize, scale, sub } from './geometry.ts'
import type { Vec } from './geometry.ts'
import type { Fracturer } from './fracture.ts'
import type { RockField } from './rocks.ts'
import {
  BREAKER_BLOW_IMPULSE,
  BREAKER_BLOWS_PER_SECOND,
  BREAKER_GRIP,
  BREAKER_MAX_FORCE,
  BREAKER_MAX_SPEED,
  BREAKER_RESPONSE,
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

export const HAMMER_SHAPE: Vec[] = [
  { x: 0, y: 0 },
  { x: 0.35, y: 0.3 },
  { x: 1.5, y: 0.3 },
  { x: 1.5, y: -0.3 },
  { x: 0.35, y: -0.3 },
]

const HAMMER_MASS = 3

export type BoomPose = { shoulder: Vec; elbow: Vec; tip: Vec; angle: number }

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

export class Breaker {
  world: World
  body: RigidBody
  collider: Collider
  target: Vec | null = null
  hammering = false
  blowClock = 0
  blowLanded = false

  constructor(world: World) {
    this.world = world
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(BOOM.park.x, BOOM.park.y)
        .setGravityScale(0)
        .lockRotations()
        .setCanSleep(false),
    )
    const outline = new Float32Array(HAMMER_SHAPE.flatMap((p) => [p.x, p.y]))
    const desc = RAPIER.ColliderDesc.convexHull(outline)
    if (!desc) {
      throw new Error('Hammer shape is not convex')
    }
    this.collider = world.createCollider(desc.setFriction(0.6).setMass(HAMMER_MASS), this.body)
  }

  pose(): BoomPose {
    const tip = this.body.translation()
    const elbow = solveElbow(tip)
    return { shoulder: BOOM.shoulder, elbow, tip, angle: Math.atan2(elbow.y - tip.y, elbow.x - tip.x) }
  }

  update(dt: number) {
    const { elbow, tip, angle } = this.pose()
    this.body.setRotation(angle, true)
    this.body.resetForces(true)
    this.body.addForce(this.steeringForce(tip), true)
    this.blowLanded = false
    if (!this.hammering) {
      this.blowClock = 0
      return
    }
    this.blowClock += dt * BREAKER_BLOWS_PER_SECOND
    if (this.blowClock >= 1) {
      this.blowClock -= 1
      const strikeDirection = normalize(sub(tip, elbow))
      this.body.applyImpulse(scale(strikeDirection, BREAKER_BLOW_IMPULSE), true)
      this.blowLanded = true
    }
  }

  resolveBlow(rocks: RockField, fracturer: Fracturer) {
    if (!this.blowLanded) {
      return
    }
    const { elbow, tip } = this.pose()
    const strikeDirection = normalize(sub(tip, elbow))
    const struck = new Set<number>()
    this.world.narrowPhase.contactPairsWith(this.collider.handle, (handle) => {
      if (rocks.byCollider.has(handle)) {
        struck.add(handle)
      }
    })
    for (const handle of struck) {
      const rock = rocks.byCollider.get(handle)
      if (rock) {
        fracturer.strike(rock, this.collider.handle, strikeDirection)
      }
    }
  }

  private steeringForce(tip: Vec): Vec {
    let goal = BOOM.park
    if (this.target) {
      goal = clampToReach(this.target)
    }
    const desiredVelocity = limit(scale(sub(goal, tip), BREAKER_RESPONSE), BREAKER_MAX_SPEED)
    const correction = sub(desiredVelocity, this.body.linvel())
    return limit(scale(correction, HAMMER_MASS * BREAKER_GRIP), BREAKER_MAX_FORCE)
  }
}

function limit(vector: Vec, maxLength: number): Vec {
  const magnitude = length(vector)
  if (magnitude <= maxLength) {
    return vector
  }
  return scale(vector, maxLength / magnitude)
}
