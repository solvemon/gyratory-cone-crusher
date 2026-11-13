export type Vec = { x: number; y: number }

export function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function add(a: Vec, b: Vec): Vec {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function scale(a: Vec, s: number): Vec {
  return { x: a.x * s, y: a.y * s }
}

export function dot(a: Vec, b: Vec): number {
  return a.x * b.x + a.y * b.y
}

export function length(a: Vec): number {
  return Math.hypot(a.x, a.y)
}

export function normalize(a: Vec): Vec {
  const len = length(a)
  if (len === 0) {
    return { x: 0, y: 0 }
  }
  return { x: a.x / len, y: a.y / len }
}

export function perpendicular(a: Vec): Vec {
  return { x: -a.y, y: a.x }
}

export function rotate(a: Vec, angle: number): Vec {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}

export function polygonArea(poly: Vec[]): number {
  let twiceArea = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    twiceArea += a.x * b.y - b.x * a.y
  }
  return Math.abs(twiceArea) / 2
}

export function polygonCentroid(poly: Vec[]): Vec {
  let cx = 0
  let cy = 0
  let twiceArea = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const cross = a.x * b.y - b.x * a.y
    twiceArea += cross
    cx += (a.x + b.x) * cross
    cy += (a.y + b.y) * cross
  }
  if (Math.abs(twiceArea) < 1e-12) {
    return poly[0]
  }
  return { x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) }
}

export function maxExtent(poly: Vec[]): number {
  let best = 0
  for (let i = 0; i < poly.length; i++) {
    for (let j = i + 1; j < poly.length; j++) {
      best = Math.max(best, length(sub(poly[i], poly[j])))
    }
  }
  return best
}

function cross(o: Vec, a: Vec, b: Vec): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

export function convexHull(points: Vec[]): Vec[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  const lower: Vec[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop()
    }
    lower.push(p)
  }
  const upper: Vec[] = []
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop()
    }
    upper.push(p)
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1))
}

export function splitPolygon(poly: Vec[], origin: Vec, normal: Vec): [Vec[], Vec[]] {
  const behind: Vec[] = []
  const ahead: Vec[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const da = dot(sub(a, origin), normal)
    const db = dot(sub(b, origin), normal)
    if (da <= 0) {
      behind.push(a)
    }
    if (da >= 0) {
      ahead.push(a)
    }
    const crossesLine = (da < 0 && db > 0) || (da > 0 && db < 0)
    if (crossesLine) {
      const t = da / (da - db)
      const hit = add(a, scale(sub(b, a), t))
      behind.push(hit)
      ahead.push(hit)
    }
  }
  return [behind, ahead]
}

export function nearestVertex(poly: Vec[], point: Vec): Vec {
  let best = poly[0]
  for (const v of poly) {
    if (length(sub(v, point)) < length(sub(best, point))) {
      best = v
    }
  }
  return best
}

export function compactness(poly: Vec[]): number {
  const size = maxExtent(poly)
  if (size === 0) {
    return 0
  }
  return polygonArea(poly) / (size * size)
}

export function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min)
}
