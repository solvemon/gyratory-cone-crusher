import type { World } from '@dimforge/rapier2d-compat'
import type { Effects } from './effects.ts'
import { normalize, randomBetween, scale, sub } from './geometry.ts'
import { contactPointBetween } from './fracture.ts'
import type { Rock, RockField } from './rocks.ts'
import { BREAKER_SHOCK_DEPTH, BREAKER_SHOCK_FALLOFF, BREAKER_SHOCK_SPEED } from './tuning.ts'

const MAX_SHAKEN_ROCKS = 40
const CONTACT_DUST_AREA = 0.002

function touchingRocks(world: World, rocks: RockField, source: Rock): Rock[] {
  const touching: Rock[] = []
  world.narrowPhase.contactPairsWith(source.collider.handle, (handle) => {
    const rock = rocks.byCollider.get(handle)
    if (rock) {
      touching.push(rock)
    }
  })
  return touching
}

function shakeUp(rock: Rock, level: number) {
  if (level <= rock.shake) {
    return
  }
  rock.shake = Math.min(1, level)
  rock.shakeDirection = randomBetween(0, Math.PI * 2)
}

function jolt(rock: Rock, source: Rock, speed: number) {
  const away = normalize(sub(rock.body.translation(), source.body.translation()))
  rock.body.applyImpulse(scale(away, rock.body.mass() * speed), true)
  const spin = (randomBetween(-1, 1) * speed) / Math.max(0.2, rock.size * 0.5)
  rock.body.applyTorqueImpulse(rock.body.principalInertia() * spin, true)
}

export function sendShock(world: World, rocks: RockField, effects: Effects, struck: Rock, intensity: number) {
  const shaken = new Set<Rock>([struck])
  shakeUp(struck, intensity)
  let wave = [struck]
  for (let depth = 0; depth < BREAKER_SHOCK_DEPTH; depth++) {
    const strength = intensity * BREAKER_SHOCK_FALLOFF ** (depth + 1)
    const speed = BREAKER_SHOCK_SPEED * strength
    const next: Rock[] = []
    for (const source of wave) {
      for (const rock of touchingRocks(world, rocks, source)) {
        if (shaken.has(rock) || shaken.size >= MAX_SHAKEN_ROCKS) {
          continue
        }
        shaken.add(rock)
        next.push(rock)
        jolt(rock, source, speed)
        shakeUp(rock, strength)
        const point = contactPointBetween(world, source.collider.handle, rock.collider.handle)
        if (point) {
          effects.dust(point, CONTACT_DUST_AREA * strength, { x: 0, y: 0 }, 0.04)
        }
      }
    }
    wave = next
  }
}
