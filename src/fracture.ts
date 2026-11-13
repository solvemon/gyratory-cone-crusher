import type { World } from '@dimforge/rapier2d-compat'
import {
  add,
  compactness,
  dot,
  length,
  maxExtent,
  nearestVertex,
  normalize,
  perpendicular,
  polygonArea,
  polygonCentroid,
  randomBetween,
  rotate,
  scale,
  splitPolygon,
  sub,
} from './geometry.ts'
import type { Vec } from './geometry.ts'
import type { Effects } from './effects.ts'
import type { Rock, RockField } from './rocks.ts'
import {
  CHIP_COOLDOWN,
  CHIP_RATIO,
  BREAKER_BLOW_DAMAGE,
  CUT_ATTEMPTS,
  DUST_SIZE,
  FATIGUE_ONSET,
  FATIGUE_RATE,
  FATIGUE_WEAKENING,
  EMBED_FRACTION,
  JAM_DEPTH,
  PULVERIZE_SIZE,
  STEEL_SPARK_CHANCE,
  LOAD_SMOOTHING,
  MAX_BREAKS_PER_STEP,
  MIN_COMPACTNESS,
} from './tuning.ts'

type Contact = { point: Vec; inward: Vec; force: number; penetration: number; steel: boolean }
type Squeeze = { a: Contact; b: Contact; force: number; penetration: number; steel: boolean }

export type FractureCounters = { cracks: number; chips: number; jams: number }

function inwardDirection(normal: Vec, flipped: boolean, point: Vec, rockCenter: Vec): Vec {
  let inward = scale(normal, -1)
  if (flipped) {
    inward = normal
  }
  const pointsAwayFromRock = dot(inward, sub(rockCenter, point)) < 0
  if (pointsAwayFromRock) {
    return scale(inward, -1)
  }
  return inward
}

function gatherContacts(world: World, rock: Rock, rocks: RockField, ignored: number | null): Contact[] {
  const contacts: Contact[] = []
  const center = rock.body.translation()
  const handle = rock.collider.handle
  world.narrowPhase.contactPairsWith(handle, (other) => {
    if (other === ignored) {
      return
    }
    world.narrowPhase.contactPair(handle, other, world.bodies, (manifold, flipped) => {
      const solverCount = manifold.numSolverContacts()
      if (solverCount === 0) {
        return
      }
      let impulse = 0
      let penetration = 0
      for (let i = 0; i < manifold.numContacts(); i++) {
        impulse += manifold.contactImpulse(i)
        penetration = Math.max(penetration, -manifold.contactDist(i))
      }
      let point = { x: 0, y: 0 }
      for (let i = 0; i < solverCount; i++) {
        const p = manifold.solverContactPoint(i)
        if (p) {
          point = add(point, scale(p, 1 / solverCount))
        }
      }
      contacts.push({
        point,
        inward: inwardDirection(manifold.normal(), flipped, point, center),
        force: Math.max(0, impulse) / world.timestep,
        penetration,
        steel: !rocks.byCollider.has(other),
      })
    })
  })
  return contacts
}

function contactPointBetween(world: World, first: number, second: number): Vec | null {
  let found: Vec | null = null
  world.narrowPhase.contactPair(first, second, world.bodies, (manifold) => {
    if (manifold.numSolverContacts() > 0) {
      found = manifold.solverContactPoint(0)
    }
  })
  return found
}

function strongestSqueeze(contacts: Contact[]): Squeeze | null {
  let best: Squeeze | null = null
  for (let i = 0; i < contacts.length; i++) {
    for (let j = i + 1; j < contacts.length; j++) {
      const a = contacts[i]
      const b = contacts[j]
      const opposition = -dot(a.inward, b.inward)
      if (opposition < 0.3) {
        continue
      }
      const force = Math.min(a.force, b.force) * opposition
      const penetration = Math.min(a.penetration, b.penetration)
      const isStronger = !best || force > best.force || penetration > best.penetration
      if (isStronger) {
        best = { a, b, force, penetration, steel: a.steel || b.steel }
      }
    }
  }
  return best
}

function strongestContact(contacts: Contact[]): Contact | null {
  let best: Contact | null = null
  for (const contact of contacts) {
    if (!best || contact.force > best.force) {
      best = contact
    }
  }
  return best
}

function isSolidPiece(piece: Vec[]): boolean {
  return piece.length >= 3 && compactness(piece) > MIN_COMPACTNESS
}

function blend(previous: number, next: number, dt: number): number {
  const keep = Math.exp(-dt / LOAD_SMOOTHING)
  return previous * keep + next * (1 - keep)
}

export class Fracturer {
  rocks: RockField
  effects: Effects
  counters: FractureCounters = { cracks: 0, chips: 0, jams: 0 }
  toolCollider: number | null = null

  constructor(rocks: RockField, effects: Effects) {
    this.rocks = rocks
    this.effects = effects
  }

  process(candidates: Set<Rock>, dt: number) {
    const breaks: Array<() => boolean> = []
    for (const rock of candidates) {
      const action = this.evaluate(rock, dt)
      if (action) {
        breaks.push(action)
      }
    }
    let done = 0
    for (const action of breaks) {
      if (done >= MAX_BREAKS_PER_STEP) {
        return
      }
      if (action()) {
        done++
      }
    }
  }

  private evaluate(rock: Rock, dt: number): (() => boolean) | null {
    rock.evaluated = true
    const contacts = gatherContacts(this.rocks.world, rock, this.rocks, this.toolCollider)
    const squeeze = strongestSqueeze(contacts)
    const hardest = strongestContact(contacts)
    let squeezeForce = 0
    if (squeeze) {
      squeezeForce = squeeze.force
    }
    let hardestForce = 0
    if (hardest) {
      hardestForce = hardest.force
    }
    rock.stress = blend(rock.stress, squeezeForce / rock.strength, dt)
    rock.chipLoad = blend(rock.chipLoad, hardestForce / rock.strength, dt)
    if (rock.stress > FATIGUE_ONSET) {
      rock.damage = Math.min(1, rock.damage + (rock.stress - FATIGUE_ONSET) * FATIGUE_RATE * dt)
    }
    const weakening = 1 - FATIGUE_WEAKENING * rock.damage

    const pressedIntoSteel = contacts.some((c) => c.steel && c.penetration > rock.size * EMBED_FRACTION)
    if (pressedIntoSteel) {
      return () => this.pulverize(rock)
    }
    const jammedAgainstSteel = squeeze && squeeze.steel && squeeze.penetration > JAM_DEPTH
    if (squeeze && jammedAgainstSteel) {
      this.counters.jams++
      return () => this.crack(rock, squeeze) || this.pulverizeIfSmall(rock)
    }
    if (squeeze && rock.stress > weakening) {
      return () => this.crack(rock, squeeze)
    }
    const canChip = rock.chipCooldown <= 0 && rock.chipLoad > weakening * CHIP_RATIO
    if (hardest && canChip) {
      return () => this.chip(rock, hardest)
    }
    return null
  }

  private crack(rock: Rock, squeeze: Squeeze): boolean {
    const polygon = this.rocks.worldPolygon(rock)
    const loadLine = normalize(sub(squeeze.b.point, squeeze.a.point))
    const midpoint = scale(add(squeeze.a.point, squeeze.b.point), 0.5)
    for (let attempt = 0; attempt < CUT_ATTEMPTS; attempt++) {
      const crackLine = rotate(loadLine, randomBetween(-0.3, 0.3))
      const crackNormal = perpendicular(crackLine)
      const offset = scale(crackNormal, randomBetween(-0.12, 0.12) * rock.size)
      const halves = splitPolygon(polygon, add(midpoint, offset), crackNormal)
      if (halves.every(isSolidPiece)) {
        this.replace(rock, halves, rock.damage * 0.5)
        this.effects.dust(midpoint, polygonArea(polygon) * 0.04, { x: 0, y: 0 }, rock.size * 0.25)
        this.effects.puff(midpoint, rock.size)
        this.sparkAgainstSteel(squeeze)
        this.counters.cracks++
        return true
      }
    }
    return false
  }

  strike(rock: Rock, hammer: number, direction: Vec): boolean {
    const point = contactPointBetween(this.rocks.world, rock.collider.handle, hammer)
    if (!point) {
      return false
    }
    rock.damage = Math.min(1, rock.damage + BREAKER_BLOW_DAMAGE / Math.max(0.5, rock.size))
    rock.stress = 1
    this.effects.dust(point, 0.004, scale(direction, -1.5), 0.08)
    this.effects.spark(point, scale(direction, -1), Math.round(randomBetween(3, 7)))
    if (rock.damage < 1) {
      return false
    }
    return this.splitAlong(rock, point, direction) || this.pulverizeIfSmall(rock)
  }

  private splitAlong(rock: Rock, point: Vec, direction: Vec): boolean {
    const polygon = this.rocks.worldPolygon(rock)
    for (let attempt = 0; attempt < CUT_ATTEMPTS; attempt++) {
      const crackNormal = perpendicular(rotate(direction, randomBetween(-0.2, 0.2)))
      const halves = splitPolygon(polygon, point, crackNormal)
      if (halves.every(isSolidPiece)) {
        this.replace(rock, halves, 0.5)
        this.effects.dust(point, polygonArea(polygon) * 0.04, { x: 0, y: 0 }, rock.size * 0.25)
        this.effects.puff(point, rock.size)
        this.counters.cracks++
        return true
      }
    }
    return false
  }

  private sparkAgainstSteel(squeeze: Squeeze) {
    if (!squeeze.steel || Math.random() > STEEL_SPARK_CHANCE) {
      return
    }
    let steelContact = squeeze.b
    if (squeeze.a.steel) {
      steelContact = squeeze.a
    }
    this.effects.spark(steelContact.point, scale(steelContact.inward, -1), Math.round(randomBetween(2, 5)))
  }

  private pulverizeIfSmall(rock: Rock): boolean {
    if (rock.size > PULVERIZE_SIZE) {
      return false
    }
    return this.pulverize(rock)
  }

  private pulverize(rock: Rock): boolean {
    const center = rock.body.translation()
    const velocity = rock.body.linvel()
    this.effects.dust(center, rock.area, velocity, rock.size * 0.4)
    this.effects.puff(center, rock.size)
    this.rocks.remove(rock)
    this.counters.cracks++
    return true
  }

  private chip(rock: Rock, contact: Contact): boolean {
    const polygon = this.rocks.worldPolygon(rock)
    const corner = nearestVertex(polygon, contact.point)
    const cornerIsLoaded = length(sub(corner, contact.point)) < rock.size * 0.2
    if (!cornerIsLoaded) {
      return false
    }
    const total = polygonArea(polygon)
    const towardCenter = normalize(sub(polygonCentroid(polygon), corner))
    for (let attempt = 0; attempt < CUT_ATTEMPTS; attempt++) {
      const cutNormal = rotate(towardCenter, randomBetween(-0.35, 0.35))
      const depth = rock.size * randomBetween(0.1, 0.28)
      const [flake, remainder] = splitPolygon(polygon, add(corner, scale(cutNormal, depth)), cutNormal)
      const flakeIsChip = polygonArea(flake) < total * 0.35 && compactness(flake) > MIN_COMPACTNESS
      if (flakeIsChip && isSolidPiece(remainder)) {
        rock.chipCooldown = CHIP_COOLDOWN
        this.replace(rock, [remainder, flake], Math.min(1, rock.damage + 0.08))
        this.counters.chips++
        return true
      }
    }
    return false
  }

  private replace(rock: Rock, pieces: Vec[][], damage: number) {
    const parentCenter = rock.body.translation()
    const texture = this.rocks.textureFrame(rock)
    const usable = pieces.filter((piece) => piece.length >= 3)
    const fragments = usable.map((piece) => {
      const center = polygonCentroid(piece)
      return { piece, center, motion: this.rocks.motionAt(rock, center) }
    })
    this.rocks.remove(rock)
    for (const { piece, center, motion } of fragments) {
      const tooSmallToSimulate = maxExtent(piece) < DUST_SIZE
      if (tooSmallToSimulate) {
        this.effects.dust(center, polygonArea(piece), motion.velocity, maxExtent(piece))
        continue
      }
      const kick = scale(normalize(sub(center, parentCenter)), 0.3)
      motion.velocity = add(motion.velocity, kick)
      const fragment = this.rocks.add(piece, motion, rock.look, damage, texture)
      if (fragment) {
        fragment.chipCooldown = CHIP_COOLDOWN
      }
    }
  }
}
