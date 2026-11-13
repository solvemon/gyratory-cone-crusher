import { initPhysics, Sim } from '../src/sim.ts'
import { STEP_DT } from '../src/tuning.ts'
import { MANTLE_PARTS, STATIC_PARTS, PIVOT } from '../src/machine.ts'
import { rotate, sub, add } from '../src/geometry.ts'
import type { Vec } from '../src/geometry.ts'

function insideConvex(poly: Vec[], p: Vec): boolean {
  let sign = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    const s = Math.sign(c)
    if (s === 0) continue
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

await initPhysics()
const sim = new Sim()
const seconds = Number(process.argv[2] ?? 40)
const pourSeconds = Number(process.argv[3] ?? 25)
let stepMs = 0
let physMs = 0
let fracMs = 0
let steps = 0
let reachedBelt = 0
for (let i = 0; i < seconds / STEP_DT; i++) {
  const t = i * STEP_DT
  if (t < pourSeconds) {
    sim.pourer.target = { x: Math.sin(t * 0.7) * 4, y: 18.5 }
  } else {
    sim.pourer.target = null
  }
  const start = performance.now()
  sim.step(STEP_DT)
  stepMs += performance.now() - start
  physMs += sim.timings.physics
  fracMs += sim.timings.fracture
  steps++
  for (const rock of sim.rocks.byCollider.values()) {
    if (rock.body.translation().y < -2.5) reachedBelt++
  }
  if (i % Math.round(2 / STEP_DT) === 0) {
    const all = [...sim.rocks.byCollider.values()]
    const mantle = MANTLE_PARTS.map((poly) => poly.map((p) => add(rotate(sub(p, PIVOT), sim.machine.angle), PIVOT)))
    const embedded = all.filter((r) => {
      const c = r.body.translation()
      return [...STATIC_PARTS, ...mantle].some((poly) => insideConvex(poly, c))
    }).length
    const buckets = [0, 0.3, 0.8, 1.4, 9].map((min, k, arr) => {
      const inBucket = all.filter((r) => r.size >= min && r.size < (arr[k + 1] ?? 99))
      const stressed = inBucket.filter((r) => r.stress > 0.3).length
      const hopperStressed = inBucket.filter((r) => r.stress > 0.3 && r.body.translation().y > 13.5).length
      return `${min}:${inBucket.length}/s${stressed}/h${hopperStressed}`
    })
    const damaged = all.filter((r) => r.damage > 0.2).length
    console.log(
      `t=${t.toFixed(0).padStart(3)} n=${all.length} cracks=${sim.fracturer.counters.cracks} jams=${sim.fracturer.counters.jams} chips=${sim.fracturer.counters.chips} ` +
        `dmg=${damaged} emb=${embedded} ms=${(stepMs / steps).toFixed(1)}(p${(physMs / steps).toFixed(1)} f${(fracMs / steps).toFixed(1)}) dust=${sim.effects.grains.length} belt=${reachedBelt > 0} | ${buckets.slice(0, 4).join(' ')}`,
    )
    stepMs = 0
    physMs = 0
    fracMs = 0
    steps = 0
  }
}
