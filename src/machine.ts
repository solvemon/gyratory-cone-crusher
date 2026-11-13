import RAPIER from '@dimforge/rapier2d-compat'
import type { RigidBody, World } from '@dimforge/rapier2d-compat'
import type { Vec } from './geometry.ts'
import { MANTLE_HZ, MANTLE_SPIN_UP_SECONDS, MANTLE_THROW_AT_BOTTOM, STEEL_FRICTION } from './tuning.ts'

export const PIVOT: Vec = { x: 0, y: 16 }
export const MANTLE_BOTTOM_Y = 1.6
export const DISCHARGE_Y = 0.4
export const OUTLET = { halfWidth: 1.6, y: -1.8 }
export const GROUND_Y = -7
export const VIEW = { left: -10.5, right: 14, bottom: GROUND_Y - 0.7, top: 22 }
export const ESSENTIAL_VIEW = { left: -9.3, right: 9.3, bottom: GROUND_Y - 0.7, top: 22 }

const AMPLITUDE = MANTLE_THROW_AT_BOTTOM / (PIVOT.y - MANTLE_BOTTOM_Y)

function mirrored(poly: Vec[]): Vec[] {
  return poly.map((p) => ({ x: -p.x, y: p.y })).reverse()
}

function withMirror(polys: Vec[][]): Vec[][] {
  return polys.concat(polys.map(mirrored))
}

const LEFT_STATIC_PARTS: Vec[][] = [
  [{ x: -4.6, y: 13.5 }, { x: -3.6, y: 2.0 }, { x: -5.6, y: 2.0 }, { x: -6.6, y: 13.5 }],
  [{ x: -3.6, y: 2.0 }, { x: -3.6, y: 0.4 }, { x: -5.6, y: 0.4 }, { x: -5.6, y: 2.0 }],
  [{ x: -4.6, y: 13.5 }, { x: -6.6, y: 13.5 }, { x: -9.0, y: 17.5 }, { x: -7.6, y: 17.5 }],
  [{ x: -3.6, y: 0.4 }, { x: -OUTLET.halfWidth, y: OUTLET.y }, { x: -2.5, y: OUTLET.y }, { x: -5.6, y: 0.4 }],
]

export const STATIC_PARTS: Vec[][] = withMirror(LEFT_STATIC_PARTS).concat([
  [{ x: -2.0, y: 1.4 }, { x: 2.0, y: 1.4 }, { x: 0.7, y: -0.3 }, { x: -0.7, y: -0.3 }],
  [{ x: 8.4, y: 15.4 }, { x: 14.6, y: 15.4 }, { x: 14.6, y: 15.0 }, { x: 8.4, y: 15.0 }],
])

export const MANTLE_PARTS: Vec[][] = [
  [
    { x: -3.2, y: 2.0 },
    { x: -3.0, y: MANTLE_BOTTOM_Y },
    { x: 3.0, y: MANTLE_BOTTOM_Y },
    { x: 3.2, y: 2.0 },
    { x: 1.0, y: 11.2 },
    { x: 0.35, y: 12.6 },
    { x: -0.35, y: 12.6 },
    { x: -1.0, y: 11.2 },
  ],
  [{ x: -0.35, y: 11.8 }, { x: 0.35, y: 11.8 }, { x: 0.35, y: 15.5 }, { x: -0.35, y: 15.5 }],
  [{ x: -0.9, y: 16.0 }, { x: -0.5, y: 15.4 }, { x: 0.5, y: 15.4 }, { x: 0.9, y: 16.0 }, { x: 0, y: 16.9 }],
]

function toFloats(poly: Vec[], origin: Vec): Float32Array {
  return new Float32Array(poly.flatMap((p) => [p.x - origin.x, p.y - origin.y]))
}

function addConvexCollider(world: World, body: RigidBody, poly: Vec[], origin: Vec): number {
  const desc = RAPIER.ColliderDesc.convexHull(toFloats(poly, origin))
  if (!desc) {
    throw new Error('Machine part is not a valid convex polygon')
  }
  return world.createCollider(desc.setFriction(STEEL_FRICTION), body).handle
}

export class Machine {
  mantle: RigidBody
  mantleColliders: number[]
  steelColliders: number[]
  angle = 0
  running = true
  speed = 0
  phase = 0

  constructor(world: World) {
    const ground = world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    const frameColliders = STATIC_PARTS.map((part) => addConvexCollider(world, ground, part, { x: 0, y: 0 }))

    this.mantle = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(PIVOT.x, PIVOT.y),
    )
    this.mantleColliders = MANTLE_PARTS.map((part) => addConvexCollider(world, this.mantle, part, PIVOT))
    this.steelColliders = frameColliders.concat(this.mantleColliders)
  }

  update(dt: number) {
    const targetSpeed = this.running ? 1 : 0
    const maxChange = dt / MANTLE_SPIN_UP_SECONDS
    this.speed += Math.max(-maxChange, Math.min(maxChange, targetSpeed - this.speed))
    this.phase += 2 * Math.PI * MANTLE_HZ * this.speed * dt
    this.angle = AMPLITUDE * Math.sin(this.phase)
    this.mantle.setNextKinematicRotation(this.angle)
  }
}
