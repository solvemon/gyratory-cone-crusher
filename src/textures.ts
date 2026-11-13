type Random = () => number

function tileableNoise(size: number, cells: number, random: Random): Float32Array {
  const grid = Array.from({ length: cells * cells }, random)
  const at = (x: number, y: number) => grid[((y + cells) % cells) * cells + ((x + cells) % cells)]
  const out = new Float32Array(size * size)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const gx = (px / size) * cells
      const gy = (py / size) * cells
      const x0 = Math.floor(gx)
      const y0 = Math.floor(gy)
      const tx = smooth(gx - x0)
      const ty = smooth(gy - y0)
      const top = at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx
      const bottom = at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx
      out[py * size + px] = top * (1 - ty) + bottom * ty
    }
  }
  return out
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t)
}

function fractalNoise(size: number, octaves: Array<[number, number]>, random: Random): Float32Array {
  const sum = new Float32Array(size * size)
  let totalWeight = 0
  for (const [cells, weight] of octaves) {
    const layer = tileableNoise(size, cells, random)
    for (let i = 0; i < sum.length; i++) {
      sum[i] += layer[i] * weight
    }
    totalWeight += weight
  }
  for (let i = 0; i < sum.length; i++) {
    sum[i] /= totalWeight
  }
  return sum
}

function seeded(seed: number): Random {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

function newTile(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D is not available')
  }
  return [canvas, context]
}

function forEachWrapped(size: number, x: number, y: number, draw: (x: number, y: number) => void) {
  for (const dx of [-size, 0, size]) {
    for (const dy of [-size, 0, size]) {
      draw(x + dx, y + dy)
    }
  }
}

type Blotch = { x: number; y: number; radius: number; stretch: number; color: string }

function blotch(context: CanvasRenderingContext2D, size: number, spot: Blotch) {
  forEachWrapped(size, spot.x, spot.y, (wx, wy) => {
    context.save()
    context.translate(wx, wy)
    context.scale(1, spot.stretch)
    const gradient = context.createRadialGradient(0, 0, 0, 0, 0, spot.radius)
    gradient.addColorStop(0, spot.color)
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
    context.fillStyle = gradient
    context.fillRect(-spot.radius, -spot.radius, spot.radius * 2, spot.radius * 2)
    context.restore()
  })
}

export function createRockTile(): HTMLCanvasElement {
  const size = 256
  const random = seeded(7)
  const [canvas, context] = newTile(size)
  const noise = fractalNoise(size, [[4, 1], [8, 0.7], [16, 0.5], [32, 0.35], [64, 0.25]], random)
  const image = context.createImageData(size, size)
  for (let i = 0; i < noise.length; i++) {
    let value = 128 + (noise[i] - 0.5) * 150
    const grain = random()
    if (grain < 0.04) {
      value -= 55
    } else if (grain > 0.975) {
      value += 45
    }
    image.data[i * 4] = value
    image.data[i * 4 + 1] = value
    image.data[i * 4 + 2] = value
    image.data[i * 4 + 3] = 255
  }
  context.putImageData(image, 0, 0)
  context.lineWidth = 1
  for (let vein = 0; vein < 5; vein++) {
    let x = random() * size
    let y = random() * size
    let heading = random() * Math.PI * 2
    context.strokeStyle = `rgba(${random() < 0.5 ? 70 : 190}, ${random() < 0.5 ? 70 : 190}, 128, 0.35)`
    context.beginPath()
    context.moveTo(x, y)
    for (let step = 0; step < 14; step++) {
      heading += (random() - 0.5) * 0.9
      x += Math.cos(heading) * 7
      y += Math.sin(heading) * 7
      context.lineTo(x, y)
    }
    context.stroke()
  }
  return canvas
}

export function createSteelTile(): HTMLCanvasElement {
  const size = 512
  const random = seeded(42)
  const [canvas, context] = newTile(size)
  const noise = fractalNoise(size, [[3, 1], [6, 0.8], [12, 0.5], [48, 0.3], [128, 0.25]], random)
  const rowStreaks = Array.from({ length: size }, () => (random() - 0.5) * 7)
  const image = context.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      const shade = (noise[i] - 0.5) * 34 + rowStreaks[y]
      image.data[i * 4] = 50 + shade
      image.data[i * 4 + 1] = 57 + shade
      image.data[i * 4 + 2] = 65 + shade
      image.data[i * 4 + 3] = 255
    }
  }
  context.putImageData(image, 0, 0)

  for (let i = 0; i < 40; i++) {
    const radius = 10 + random() * 40
    blotch(context, size, {
      x: random() * size,
      y: random() * size,
      radius,
      stretch: 1.5 + random() * 3,
      color: `rgba(8, 10, 12, ${0.12 + random() * 0.18})`,
    })
  }
  for (let i = 0; i < 14; i++) {
    blotch(context, size, {
      x: random() * size,
      y: random() * size,
      radius: 3 + random() * 12,
      stretch: 1 + random() * 2,
      color: `rgba(125, 66, 30, ${0.12 + random() * 0.16})`,
    })
  }
  for (let i = 0; i < 260; i++) {
    const x = random() * size
    const y = random() * size
    const angle = -0.35 + (random() - 0.5) * 0.8 + (random() < 0.25 ? Math.PI / 2 : 0)
    const length = 4 + random() ** 2 * 70
    context.strokeStyle = `rgba(190, 205, 220, ${0.08 + random() * 0.22})`
    if (random() < 0.25) {
      context.strokeStyle = `rgba(0, 0, 0, ${0.2 + random() * 0.25})`
    }
    context.lineWidth = 0.5 + random() * 0.8
    forEachWrapped(size, x, y, (wx, wy) => {
      context.beginPath()
      context.moveTo(wx, wy)
      context.lineTo(wx + Math.cos(angle) * length, wy + Math.sin(angle) * length)
      context.stroke()
    })
  }
  return canvas
}

function chip(context: CanvasRenderingContext2D, size: number, random: Random, x: number, y: number) {
  const radius = 2 + random() * 8
  const corners = 6 + Math.floor(random() * 4)
  const outline = Array.from({ length: corners }, (_, i) => {
    const angle = (i / corners) * Math.PI * 2
    const reach = radius * (0.5 + random() * 0.6)
    return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach }
  })
  forEachWrapped(size, x, y, (wx, wy) => {
    context.beginPath()
    for (const point of outline) {
      context.lineTo(wx + point.x, wy + point.y)
    }
    context.closePath()
    context.fillStyle = 'rgba(58, 62, 66, 0.95)'
    context.fill()
    context.strokeStyle = 'rgba(30, 22, 6, 0.6)'
    context.lineWidth = 1
    context.stroke()
  })
}

function scratches(context: CanvasRenderingContext2D, size: number, random: Random, count: number, color: () => string) {
  for (let i = 0; i < count; i++) {
    const x = random() * size
    const y = random() * size
    const angle = random() * Math.PI * 2
    const length = 4 + random() ** 2 * 50
    context.strokeStyle = color()
    context.lineWidth = 0.5 + random() * 0.7
    forEachWrapped(size, x, y, (wx, wy) => {
      context.beginPath()
      context.moveTo(wx, wy)
      context.lineTo(wx + Math.cos(angle) * length, wy + Math.sin(angle) * length)
      context.stroke()
    })
  }
}

function grimeRuns(context: CanvasRenderingContext2D, size: number, random: Random, count: number, tint: string) {
  for (let i = 0; i < count; i++) {
    blotch(context, size, {
      x: random() * size,
      y: random() * size,
      radius: 8 + random() * 36,
      stretch: 1.5 + random() * 3,
      color: `rgba(${tint}, ${0.1 + random() * 0.25})`,
    })
  }
}

export function createPaintTile(): HTMLCanvasElement {
  const size = 512
  const random = seeded(19)
  const [canvas, context] = newTile(size)
  const noise = fractalNoise(size, [[3, 1], [8, 0.6], [24, 0.4], [96, 0.3]], random)
  const image = context.createImageData(size, size)
  for (let i = 0; i < noise.length; i++) {
    const shade = (noise[i] - 0.5) * 44
    image.data[i * 4] = 205 + shade
    image.data[i * 4 + 1] = 150 + shade
    image.data[i * 4 + 2] = 30 + shade * 0.4
    image.data[i * 4 + 3] = 255
  }
  context.putImageData(image, 0, 0)
  grimeRuns(context, size, random, 30, '45, 30, 8')
  for (let i = 0; i < 45; i++) {
    chip(context, size, random, random() * size, random() * size)
  }
  scratches(context, size, random, 140, () => `rgba(225, 222, 210, ${0.12 + random() * 0.25})`)
  return canvas
}

export function createGrimeTile(): HTMLCanvasElement {
  const size = 256
  const random = seeded(3)
  const [canvas, context] = newTile(size)
  const image = context.createImageData(size, size)
  for (let i = 0; i < size * size; i++) {
    if (random() < 0.06) {
      image.data[i * 4 + 3] = 40 + random() * 70
    }
  }
  context.putImageData(image, 0, 0)
  grimeRuns(context, size, random, 22, '20, 14, 6')
  scratches(context, size, random, 40, () => `rgba(255, 255, 255, ${0.06 + random() * 0.14})`)
  scratches(context, size, random, 25, () => `rgba(0, 0, 0, ${0.15 + random() * 0.2})`)
  return canvas
}

export function createPuffSprite(): HTMLCanvasElement {
  const size = 64
  const [canvas, context] = newTile(size)
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(206, 190, 166, 1)')
  gradient.addColorStop(0.5, 'rgba(206, 190, 166, 0.45)')
  gradient.addColorStop(1, 'rgba(206, 190, 166, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  return canvas
}
