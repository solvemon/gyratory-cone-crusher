import { writeFileSync } from 'node:fs'
import { initPhysics, Sim } from '../src/sim.ts'
import { STEP_DT } from '../src/tuning.ts'
import { MANTLE_PARTS, STATIC_PARTS, PIVOT, VIEW } from '../src/machine.ts'
import { rotate, sub, add } from '../src/geometry.ts'
import type { Vec } from '../src/geometry.ts'

const out = process.argv[2]
const times = process.argv.slice(3).map(Number)
const pourUntil = Number(process.env.POUR ?? 25)
await initPhysics()
const sim = new Sim()
const scale = 40
const path = (poly: Vec[]) =>
  'M' + poly.map((p) => `${((p.x - VIEW.left) * scale).toFixed(1)},${((VIEW.top - p.y) * scale).toFixed(1)}`).join('L') + 'Z'
let step = 0
for (const time of times) {
  while (step * STEP_DT < time) {
    const t = step * STEP_DT
    sim.pourer.target = t < pourUntil ? { x: Math.sin(t * 0.7) * 4, y: 18.5 } : null
    sim.step(STEP_DT)
    step++
  }
  const mantle = MANTLE_PARTS.map((poly) => poly.map((p) => add(rotate(sub(p, PIVOT), sim.machine.angle), PIVOT)))
  const w = (VIEW.right - VIEW.left) * scale
  const h = (VIEW.top - VIEW.bottom) * scale
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="#111"/>`
  for (const poly of [...STATIC_PARTS, ...mantle]) svg += `<path d="${path(poly)}" fill="#567"/>`
  for (const rock of sim.rocks.byCollider.values()) {
    const s = Math.min(1, rock.stress)
    const fill = `rgb(${Math.round(120 + 135 * s)},${Math.round(110 + 40 * s)},${Math.round(100 - 60 * s)})`
    svg += `<path d="${path(sim.rocks.worldPolygon(rock))}" fill="${fill}" stroke="#222" stroke-width="1"/>`
  }
  const sand = sim.effects.sand
  for (let i = 0; i < sand.count; i++) svg += `<circle cx="${(sand.x[i] - VIEW.left) * scale}" cy="${(VIEW.top - sand.y[i]) * scale}" r="1.5" fill="#cba"/>`
  svg += `<text x="10" y="30" fill="#fff" font-size="24">t=${time} n=${sim.rocks.count}</text></svg>`
  writeFileSync(`${out}-${time}.svg`, svg)
}
