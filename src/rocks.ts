import RAPIER from '@dimforge/rapier2d-compat'
import type { Collider, RigidBody, World } from '@dimforge/rapier2d-compat'
import { add, convexHull, maxExtent, polygonArea, polygonCentroid, rotate, sub } from './geometry.ts'
import type { Vec } from './geometry.ts'
import type { Skin } from './skins.ts'
import {
  CANDIDATE_RATIO,
  ROCK_DENSITY,
  ROCK_FRICTION,
  ROCK_RESTITUTION,
  STRENGTH_EXPONENT,
  STRENGTH_SCALE,
} from './tuning.ts'

export type RockLook = { hue: number; saturation: number; lightness: number }

export type Rock = {
  body: RigidBody
  collider: Collider
  local: Vec[]
  size: number
  area: number
  thickness: number
  strength: number
  damage: number
  stress: number
  chipLoad: number
  steelDepth: number
  shake: number
  wear: number
  shakeDirection: number
  evaluated: boolean
  chipCooldown: number
  look: RockLook
  skin: Skin | null
  textureOffset: Vec
  textureAngle: number
}

export type Motion = { velocity: Vec; angularVelocity: number }
export type TextureFrame = { anchor: Vec; angle: number }

export function strengthFor(thickness: number): number {
  return STRENGTH_SCALE * Math.pow(thickness, STRENGTH_EXPONENT)
}

export class RockField {
  world: World
  byCollider = new Map<number, Rock>()

  constructor(world: World) {
    this.world = world
  }

  get count(): number {
    return this.byCollider.size
  }

  add(worldPolygon: Vec[], motion: Motion, look: RockLook, damage: number, texture: TextureFrame, skin: Skin | null = null): Rock | null {
    const hull = convexHull(worldPolygon)
    if (hull.length < 3) {
      return null
    }
    const center = polygonCentroid(hull)
    const local = hull.map((p) => sub(p, center))
    const desc = RAPIER.ColliderDesc.convexHull(new Float32Array(local.flatMap((p) => [p.x, p.y])))
    if (!desc) {
      return null
    }
    const size = maxExtent(local)
    const area = polygonArea(local)
    const thickness = Math.min(size, (2 * area) / size)
    const strength = strengthFor(thickness)
    const body = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(center.x, center.y)
        .setLinvel(motion.velocity.x, motion.velocity.y)
        .setAngvel(motion.angularVelocity),
    )
    desc
      .setDensity(ROCK_DENSITY)
      .setFriction(ROCK_FRICTION)
      .setRestitution(ROCK_RESTITUTION)
      .setActiveEvents(RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS)
      .setContactForceEventThreshold(strength * CANDIDATE_RATIO)
    const collider = this.world.createCollider(desc, body)
    const rock: Rock = {
      body,
      collider,
      local,
      size,
      area,
      thickness,
      strength,
      damage,
      stress: 0,
      chipLoad: 0,
      steelDepth: 0,
      shake: 0,
      wear: 0,
      shakeDirection: 0,
      evaluated: false,
      chipCooldown: 0,
      look,
      skin,
      textureOffset: sub(texture.anchor, center),
      textureAngle: texture.angle,
    }
    this.byCollider.set(collider.handle, rock)
    return rock
  }

  remove(rock: Rock) {
    this.byCollider.delete(rock.collider.handle)
    this.world.removeRigidBody(rock.body)
  }

  worldPolygon(rock: Rock): Vec[] {
    const position = rock.body.translation()
    const angle = rock.body.rotation()
    return rock.local.map((p) => add(rotate(p, angle), position))
  }

  textureFrame(rock: Rock): TextureFrame {
    const position = rock.body.translation()
    const angle = rock.body.rotation()
    return { anchor: add(rotate(rock.textureOffset, angle), position), angle: angle + rock.textureAngle }
  }

  motionAt(rock: Rock, point: Vec): Motion {
    const position = rock.body.translation()
    const velocity = rock.body.linvel()
    const angularVelocity = rock.body.angvel()
    const offset = sub(point, position)
    return {
      velocity: { x: velocity.x - angularVelocity * offset.y, y: velocity.y + angularVelocity * offset.x },
      angularVelocity,
    }
  }
}
