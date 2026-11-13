import { add, length, normalize, perpendicular, rotate, scale, sub } from './geometry.ts'
import { BOOM, CHISEL_SHAPE, HOUSING_LENGTH, HOUSING_SHAPE } from './breaker.ts'
import type { BoomPose } from './breaker.ts'
import type { Vec } from './geometry.ts'
import { BELT, ESSENTIAL_VIEW, MANTLE_PARTS, PIVOT, STATIC_PARTS, VIEW } from './machine.ts'
import type { Rock, RockField } from './rocks.ts'
import type { Sim } from './sim.ts'
import { createPaintTile, createPuffSprite, createRockTile, createSteelTile } from './textures.ts'

const ROCK_TEXTURE_METERS_PER_PIXEL = 1.6 / 256
const STEEL_TEXTURE_METERS_PER_PIXEL = 5 / 512
const LIGHT = normalize({ x: -0.55, y: 0.85 })
const NO_ROTATION = { anchor: { x: 0, y: 0 }, angle: 0 }
const EDGE_GRIME_STEPS = [1, 0.85, 0.7, 0.56, 0.43, 0.31, 0.2, 0.1]
const MAX_PIXEL_RATIO = 2
const SPRITE_MARGIN_PIXELS = 4
const MANTLE_AXIS_LENGTH = 15
const REBAKE_TURN = 0.35
const MIN_VISIBLE_LOAD = 0.05
const ROCK_SHAKE_PIXELS = 2.5
const TOOL_SHAKE_PIXELS = 3
const SHAKE_HZ = 22
const MIN_VISIBLE_SHAKE = 0.03

type Placement = { anchor: Vec; angle: number }

const COLORS = {
  background: '#0a1017',
  grid: 'rgba(120, 170, 220, 0.05)',
  gridMajor: 'rgba(120, 170, 220, 0.1)',
  steelLit: 'rgba(205, 220, 235, 0.3)',
  paintLit: 'rgba(255, 232, 170, 0.4)',
  plateShade: 'rgba(0, 0, 0, 0.5)',
  plateOutline: 'rgba(0, 0, 0, 0.55)',
  plateSheen: 'rgba(255, 250, 240, 0.1)',
  plateShadow: 'rgba(0, 0, 0, 0.34)',
  edgeGrime: 'rgba(0, 0, 0, 0.055)',
  polishedLiner: 'rgba(215, 225, 235, 0.32)',
  cylinderBarrel: '#262b30',
  cylinderRod: 'rgba(214, 222, 230, 0.85)',
  roller: '#171b1f',
  jointFill: '#29323b',
  rockOutline: 'rgba(18, 14, 10, 0.7)',
  rockLit: 'rgba(255, 240, 215, 0.28)',
  rockShade: 'rgba(0, 0, 0, 0.4)',
  ghost: 'rgba(143, 179, 209, 0.12)',
  belt: '#2b333b',
  dust: '214, 196, 170',
}

type Frame = { scale: number; originX: number; originY: number; dpr: number }

type Bounds = { left: number; right: number; bottom: number; top: number }

export type ScreenArea = { left: number; top: number; width: number; height: number }

function placeWindow(preferredMin: number, preferredMax: number, essentialMin: number, essentialMax: number, size: number) {
  const centered = (preferredMin + preferredMax) / 2 - size / 2
  return Math.min(essentialMin, Math.max(essentialMax - size, centered))
}

export type Layers = {
  backdrop: HTMLCanvasElement
  view: HTMLCanvasElement
  steel: HTMLCanvasElement
  tools: HTMLCanvasElement
}

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

type RockSprite = {
  image: ImageBitmap
  angle: number
  scale: number
  dpr: number
  width: number
  height: number
  centerX: number
  centerY: number
  lastDrawn: number
}

type Sprite = { image: ImageBitmap; world: Bounds; margin: number; width: number; height: number }

function contextOf(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D is not available')
  }
  return context
}

function poseSignature(pose: BoomPose, pourTarget: Vec | null): string {
  const numbers = [pose.tip.x, pose.tip.y, pose.chisel.x, pose.chisel.y, pose.elbow.x, pose.elbow.y, pose.angle * 10]
  if (pourTarget) {
    numbers.push(pourTarget.x, pourTarget.y)
  }
  return numbers.map((value) => value.toFixed(3)).join(',')
}

export class Renderer {
  layers: Layers
  canvas: HTMLCanvasElement
  context: Context2D
  frame: Frame = { scale: 1, originX: 0, originY: 0, dpr: 1 }
  visible: Bounds = VIEW
  rockTexture: CanvasPattern
  steelTexture: CanvasPattern
  paintTexture: CanvasPattern
  puffSprite: ImageBitmap
  private viewContext: CanvasRenderingContext2D
  private mantleSprite: Sprite | null = null
  private toolsSignature = ''
  private rockSprites = new Map<Rock, RockSprite>()
  private frameNumber = 0
  private bakery = new OffscreenCanvas(1, 1)

  constructor(layers: Layers) {
    this.layers = layers
    this.canvas = layers.view
    this.viewContext = contextOf(layers.view)
    this.context = this.viewContext
    this.rockTexture = this.pattern(createRockTile())
    this.steelTexture = this.pattern(createSteelTile())
    this.paintTexture = this.pattern(createPaintTile())
    this.puffSprite = toBitmap(createPuffSprite())
  }

  resize(area: ScreenArea) {
    const dpr = Math.min(MAX_PIXEL_RATIO, window.devicePixelRatio || 1)
    const width = this.canvas.clientWidth
    const height = this.canvas.clientHeight
    for (const layer of Object.values(this.layers)) {
      layer.width = Math.round(width * dpr)
      layer.height = Math.round(height * dpr)
    }
    const essentialWidth = ESSENTIAL_VIEW.right - ESSENTIAL_VIEW.left
    const essentialHeight = ESSENTIAL_VIEW.top - ESSENTIAL_VIEW.bottom
    const scale = Math.min(area.width / essentialWidth, area.height / essentialHeight)
    const worldLeft = placeWindow(VIEW.left, VIEW.right, ESSENTIAL_VIEW.left, ESSENTIAL_VIEW.right, area.width / scale)
    const worldBottom = placeWindow(VIEW.bottom, VIEW.top, ESSENTIAL_VIEW.bottom, ESSENTIAL_VIEW.top, area.height / scale)
    this.frame = {
      scale,
      originX: area.left - worldLeft * scale,
      originY: area.top + area.height + worldBottom * scale,
      dpr,
    }
    const topLeft = this.screenToWorld(0, 0)
    const bottomRight = this.screenToWorld(width, height)
    this.visible = { left: topLeft.x, right: bottomRight.x, bottom: bottomRight.y, top: topLeft.y }
    this.paintFixedLayers()
  }

  screenToWorld(x: number, y: number): Vec {
    return { x: (x - this.frame.originX) / this.frame.scale, y: (this.frame.originY - y) / this.frame.scale }
  }

  draw(sim: Sim, pourTarget: Vec | null, showLoad: boolean) {
    const ctx = this.viewContext
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.useWorldTransform()
    this.drawRocks(sim, showLoad)
    this.drawGrains(sim)
    this.drawPuffs(sim)
    this.drawSparks(sim)
    this.drawMantleSprite(sim.machine.angle)
    this.drawTools(this.shaken(sim.breaker.pose(), sim.breaker.shake, sim.time), pourTarget)
  }

  private paintOn(canvas: HTMLCanvasElement, paint: () => void) {
    this.context = contextOf(canvas)
    this.context.setTransform(1, 0, 0, 1, 0, 0)
    this.context.clearRect(0, 0, canvas.width, canvas.height)
    this.useWorldTransform()
    paint()
    this.context = this.viewContext
  }

  private paintFixedLayers() {
    this.paintOn(this.layers.backdrop, () => {
      const { left, right, bottom, top } = this.visible
      this.context.fillStyle = COLORS.background
      this.context.fillRect(left, bottom, right - left, top - bottom)
      this.drawGrid()
    })
    this.paintOn(this.layers.steel, () => this.drawStatic())
    this.mantleSprite?.image.close()
    this.mantleSprite = this.paintMantleSprite()
    this.toolsSignature = ''
  }

  private paintMantleSprite(): Sprite {
    const outline = boundsOf(MANTLE_PARTS.flat())
    const world = { ...outline, bottom: Math.min(outline.bottom, PIVOT.y - MANTLE_AXIS_LENGTH) }
    const { scale, dpr } = this.frame
    const margin = SPRITE_MARGIN_PIXELS
    const width = (world.right - world.left) * scale + margin * 2
    const height = (world.top - world.bottom) * scale + margin * 2
    const sprite = this.bakeSprite(width, height)
    sprite.setTransform(scale * dpr, 0, 0, -scale * dpr, (margin - world.left * scale) * dpr, (margin + world.top * scale) * dpr)
    this.context = sprite
    this.drawMantle(0)
    this.context = this.viewContext
    return { image: this.bakery.transferToImageBitmap(), world, margin, width, height }
  }

  private bakeSprite(width: number, height: number): OffscreenCanvasRenderingContext2D {
    this.bakery.width = Math.ceil(width * this.frame.dpr)
    this.bakery.height = Math.ceil(height * this.frame.dpr)
    const context = this.bakery.getContext('2d')
    if (!context) {
      throw new Error('Offscreen canvas 2D is not available')
    }
    return context
  }

  private drawMantleSprite(angle: number) {
    const sprite = this.mantleSprite
    if (!sprite) {
      return
    }
    const ctx = this.viewContext
    const { scale, originX, originY, dpr } = this.frame
    const pivotX = originX + PIVOT.x * scale
    const pivotY = originY - PIVOT.y * scale
    const spriteLeft = originX + sprite.world.left * scale - sprite.margin
    const spriteTop = originY - sprite.world.top * scale - sprite.margin
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.translate(pivotX, pivotY)
    ctx.rotate(-angle)
    ctx.drawImage(sprite.image, spriteLeft - pivotX, spriteTop - pivotY, sprite.width, sprite.height)
    this.useWorldTransform()
  }

  private shaken(pose: BoomPose, shake: number, time: number): BoomPose {
    const offset = (vibration(shake, time, 0) * TOOL_SHAKE_PIXELS) / this.frame.scale
    if (offset === 0) {
      return pose
    }
    const along = { x: -Math.cos(pose.angle) * offset, y: -Math.sin(pose.angle) * offset }
    return { ...pose, tip: add(pose.tip, along), chisel: add(pose.chisel, along) }
  }

  private drawTools(pose: BoomPose, pourTarget: Vec | null) {
    const signature = poseSignature(pose, pourTarget)
    if (signature === this.toolsSignature) {
      return
    }
    this.toolsSignature = signature
    this.paintOn(this.layers.tools, () => {
      this.drawBreaker(pose)
      this.drawPourMarker(pourTarget)
    })
  }

  private useWorldTransform() {
    const { scale, originX, originY, dpr } = this.frame
    this.context.setTransform(scale * dpr, 0, 0, -scale * dpr, originX * dpr, originY * dpr)
  }

  private pixels(count: number): number {
    return count / this.frame.scale
  }

  private tracePolygon(poly: Vec[]) {
    const ctx = this.context
    ctx.beginPath()
    ctx.moveTo(poly[0].x, poly[0].y)
    for (let i = 1; i < poly.length; i++) {
      ctx.lineTo(poly[i].x, poly[i].y)
    }
    ctx.closePath()
  }

  private drawGrid() {
    const ctx = this.context
    const { left, right, bottom, top } = this.visible
    ctx.lineWidth = this.pixels(1)
    for (let x = Math.ceil(left); x <= right; x++) {
      ctx.strokeStyle = gridColor(x)
      ctx.beginPath()
      ctx.moveTo(x, bottom)
      ctx.lineTo(x, top)
      ctx.stroke()
    }
    for (let y = Math.ceil(bottom); y <= top; y++) {
      ctx.strokeStyle = gridColor(y)
      ctx.beginPath()
      ctx.moveTo(left, y)
      ctx.lineTo(right, y)
      ctx.stroke()
    }
  }

  private pattern(tile: HTMLCanvasElement): CanvasPattern {
    const pattern = this.context.createPattern(tile, 'repeat')
    if (!pattern) {
      throw new Error('Could not create texture pattern')
    }
    return pattern
  }

  private drawRocks(sim: Sim, showLoad: boolean) {
    const ctx = this.viewContext
    const { scale, originX, originY, dpr } = this.frame
    this.frameNumber++
    for (const rock of sim.rocks.byCollider.values()) {
      const angle = rock.body.rotation()
      const sprite = this.rockSpriteFor(sim.rocks, rock, angle)
      sprite.lastDrawn = this.frameNumber
      const center = rock.body.translation()
      const wobble = vibration(rock.shake, sim.time, rock.shakeDirection) * ROCK_SHAKE_PIXELS
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.translate(
        originX + center.x * scale + Math.cos(rock.shakeDirection) * wobble,
        originY - center.y * scale + Math.sin(rock.shakeDirection) * wobble,
      )
      ctx.rotate(sprite.angle - angle)
      ctx.drawImage(sprite.image, -sprite.centerX, -sprite.centerY, sprite.width, sprite.height)
    }
    this.useWorldTransform()
    this.releaseUnusedRockSprites()
    if (showLoad) {
      this.drawLoadGlow(sim)
    }
  }

  private releaseUnusedRockSprites() {
    for (const [rock, sprite] of this.rockSprites) {
      if (sprite.lastDrawn !== this.frameNumber) {
        sprite.image.close()
        this.rockSprites.delete(rock)
      }
    }
  }

  private rockSpriteFor(rocks: RockField, rock: Rock, angle: number): RockSprite {
    const cached = this.rockSprites.get(rock)
    if (cached && cached.scale === this.frame.scale && cached.dpr === this.frame.dpr && turnBetween(cached.angle, angle) < REBAKE_TURN) {
      return cached
    }
    cached?.image.close()
    const sprite = this.bakeRock(rocks, rock, angle)
    this.rockSprites.set(rock, sprite)
    return sprite
  }

  private bakeRock(rocks: RockField, rock: Rock, angle: number): RockSprite {
    const polygon = rock.local.map((p) => rotate(p, angle))
    const bounds = boundsOf(polygon)
    const { scale, dpr } = this.frame
    const margin = SPRITE_MARGIN_PIXELS
    const width = (bounds.right - bounds.left) * scale + margin * 2
    const height = (bounds.top - bounds.bottom) * scale + margin * 2
    const centerX = margin - bounds.left * scale
    const centerY = margin + bounds.top * scale
    const ctx = this.bakeSprite(width, height)
    ctx.setTransform(scale * dpr, 0, 0, -scale * dpr, centerX * dpr, centerY * dpr)
    this.context = ctx
    this.tracePolygon(polygon)
    ctx.fillStyle = rockColor(rock)
    ctx.fill()
    const texture = rocks.textureFrame(rock)
    const anchor = sub(texture.anchor, rock.body.translation())
    this.rockTexture.setTransform(placementMatrix({ anchor, angle: texture.angle }, ROCK_TEXTURE_METERS_PER_PIXEL))
    ctx.globalCompositeOperation = 'overlay'
    ctx.fillStyle = this.rockTexture
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    const lit = new Path2D()
    const shaded = new Path2D()
    const outline = new Path2D()
    addShadedEdges(polygon, lit, shaded, outline)
    ctx.lineJoin = 'round'
    ctx.lineWidth = this.pixels(1)
    ctx.strokeStyle = COLORS.rockOutline
    ctx.stroke(outline)
    ctx.lineWidth = this.pixels(1.5)
    ctx.strokeStyle = COLORS.rockShade
    ctx.stroke(shaded)
    ctx.strokeStyle = COLORS.rockLit
    ctx.stroke(lit)
    this.context = this.viewContext
    return { image: this.bakery.transferToImageBitmap(), angle, scale, dpr, width, height, centerX, centerY, lastDrawn: this.frameNumber }
  }

  private drawLoadGlow(sim: Sim) {
    const ctx = this.viewContext
    for (const rock of sim.rocks.byCollider.values()) {
      const load = Math.min(1, rock.stress)
      if (load < MIN_VISIBLE_LOAD) {
        continue
      }
      this.tracePolygon(sim.rocks.worldPolygon(rock))
      ctx.fillStyle = `hsla(28, 85%, 60%, ${load * 0.85})`
      ctx.fill()
    }
  }

  private drawGrains(sim: Sim) {
    const ctx = this.context
    ctx.fillStyle = `rgb(${COLORS.dust})`
    for (const grain of sim.effects.grains) {
      ctx.globalAlpha = 0.75 * (1 - grain.age / grain.life)
      ctx.fillRect(grain.x - grain.size / 2, grain.y - grain.size / 2, grain.size, grain.size)
    }
    ctx.globalAlpha = 1
  }

  private drawPuffs(sim: Sim) {
    const ctx = this.context
    for (const puff of sim.effects.puffs) {
      const progress = puff.age / puff.life
      const fadeIn = Math.min(1, progress * 6)
      ctx.globalAlpha = 0.16 * fadeIn * (1 - progress)
      ctx.drawImage(this.puffSprite, puff.x - puff.radius, puff.y - puff.radius, puff.radius * 2, puff.radius * 2)
    }
    ctx.globalAlpha = 1
  }

  private drawSparks(sim: Sim) {
    const ctx = this.context
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineCap = 'round'
    ctx.lineWidth = this.pixels(1.6)
    for (const spark of sim.effects.sparks) {
      const progress = spark.age / spark.life
      ctx.strokeStyle = `rgba(255, ${Math.round(235 - 110 * progress)}, ${Math.round(160 - 130 * progress)}, ${1 - progress})`
      ctx.beginPath()
      ctx.moveTo(spark.x, spark.y)
      ctx.lineTo(spark.x - spark.vx * 0.025, spark.y - spark.vy * 0.025)
      ctx.stroke()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  private drawSteel(poly: Vec[], placement: Placement = NO_ROTATION) {
    this.drawPlate(poly, placement, this.steelTexture, COLORS.steelLit)
  }

  private drawPainted(poly: Vec[], placement: Placement) {
    this.drawPlate(poly, placement, this.paintTexture, COLORS.paintLit)
  }

  private drawPlate(poly: Vec[], placement: Placement, texture: CanvasPattern, litEdge: string) {
    const ctx = this.context
    const outline = counterClockwise(poly)
    texture.setTransform(placementMatrix(placement, STEEL_TEXTURE_METERS_PER_PIXEL))
    this.tracePolygon(outline)
    ctx.fillStyle = texture
    ctx.fill()
    ctx.save()
    ctx.clip()
    const bounds = boundsOf(outline)
    this.shadeAcross(bounds)
    this.darkenTowardEdges(outline, bounds)
    ctx.restore()
    this.strokeLitEdges(outline, litEdge)
  }

  private shadeAcross(bounds: Bounds) {
    const ctx = this.context
    const center = { x: (bounds.left + bounds.right) / 2, y: (bounds.bottom + bounds.top) / 2 }
    const reach = Math.hypot(bounds.right - bounds.left, bounds.top - bounds.bottom) / 2
    const lit = add(center, scale(LIGHT, reach))
    const dark = sub(center, scale(LIGHT, reach))
    const gradient = ctx.createLinearGradient(lit.x, lit.y, dark.x, dark.y)
    gradient.addColorStop(0, COLORS.plateSheen)
    gradient.addColorStop(0.5, 'rgba(0, 0, 0, 0)')
    gradient.addColorStop(1, COLORS.plateShadow)
    ctx.fillStyle = gradient
    ctx.fillRect(bounds.left, bounds.bottom, bounds.right - bounds.left, bounds.top - bounds.bottom)
  }

  private darkenTowardEdges(outline: Vec[], bounds: Bounds) {
    const ctx = this.context
    const narrowest = Math.min(bounds.right - bounds.left, bounds.top - bounds.bottom)
    const band = Math.min(0.45, narrowest * 0.3)
    ctx.strokeStyle = COLORS.edgeGrime
    ctx.lineJoin = 'round'
    for (const share of EDGE_GRIME_STEPS) {
      ctx.lineWidth = band * 2 * share
      this.tracePolygon(outline)
      ctx.stroke()
    }
  }

  private strokeLitEdges(outline: Vec[], litEdge: string) {
    const ctx = this.context
    const lit = new Path2D()
    const shaded = new Path2D()
    const edges = new Path2D()
    addShadedEdges(outline, lit, shaded, edges)
    ctx.lineWidth = this.pixels(1)
    ctx.strokeStyle = COLORS.plateOutline
    ctx.stroke(edges)
    ctx.lineWidth = this.pixels(1.5)
    ctx.strokeStyle = COLORS.plateShade
    ctx.stroke(shaded)
    ctx.lineWidth = this.pixels(1)
    ctx.strokeStyle = litEdge
    ctx.stroke(lit)
  }

  private drawStatic() {
    for (const part of STATIC_PARTS) {
      this.drawSteel(part)
    }
    const ctx = this.context
    ctx.fillStyle = COLORS.belt
    ctx.fillRect(BELT.left, BELT.top - BELT.thickness, BELT.right - BELT.left, BELT.thickness)
    ctx.strokeStyle = COLORS.steelLit
    ctx.lineWidth = this.pixels(1)
    ctx.beginPath()
    ctx.moveTo(BELT.left, BELT.top)
    ctx.lineTo(BELT.right, BELT.top)
    ctx.stroke()
    for (let x = BELT.left + 0.5; x < BELT.right; x += 1.2) {
      this.drawPin({ x, y: BELT.top - BELT.thickness / 2 }, BELT.thickness * 0.3, COLORS.roller)
    }
  }

  private drawMantle(angle: number) {
    const ctx = this.context
    const parts = MANTLE_PARTS.map((part) => part.map((p) => add(rotate(sub(p, PIVOT), angle), PIVOT)))
    const mantlePlacement = { anchor: sub(PIVOT, rotate(PIVOT, angle)), angle }
    for (const part of parts) {
      this.drawSteel(part, mantlePlacement)
    }
    const cone = parts[0]
    ctx.strokeStyle = COLORS.polishedLiner
    ctx.lineWidth = this.pixels(2)
    ctx.beginPath()
    ctx.moveTo(cone[7].x, cone[7].y)
    ctx.lineTo(cone[0].x, cone[0].y)
    ctx.moveTo(cone[4].x, cone[4].y)
    ctx.lineTo(cone[3].x, cone[3].y)
    ctx.stroke()

    const axisEnd = add(rotate({ x: 0, y: -MANTLE_AXIS_LENGTH }, angle), PIVOT)
    ctx.setLineDash([this.pixels(6), this.pixels(6)])
    ctx.strokeStyle = COLORS.ghost
    ctx.lineWidth = this.pixels(1)
    ctx.beginPath()
    ctx.moveTo(PIVOT.x, PIVOT.y + 1.5)
    ctx.lineTo(axisEnd.x, axisEnd.y)
    ctx.stroke()
    ctx.setLineDash([])
  }

  private drawBreaker(pose: BoomPose) {
    const ctx = this.context
    const { shoulder, elbow, tip, angle } = pose
    const hammerBack = add(tip, rotate({ x: HOUSING_LENGTH, y: 0 }, angle))
    const pedestal = BOOM.pedestal
    this.drawPainted([
      { x: pedestal.x - 0.35, y: pedestal.y },
      { x: pedestal.x + 0.35, y: pedestal.y },
      { x: shoulder.x + 0.25, y: shoulder.y },
      { x: shoulder.x - 0.25, y: shoulder.y },
    ], NO_ROTATION)
    const cylinderBase = { x: pedestal.x + 0.3, y: pedestal.y + 0.3 }
    const cylinderEnd = add(shoulder, scale(sub(elbow, shoulder), 0.45))
    const barrelEnd = add(cylinderBase, scale(sub(cylinderEnd, cylinderBase), 0.55))
    ctx.lineCap = 'round'
    ctx.strokeStyle = COLORS.cylinderRod
    ctx.lineWidth = 0.07
    ctx.beginPath()
    ctx.moveTo(barrelEnd.x, barrelEnd.y)
    ctx.lineTo(cylinderEnd.x, cylinderEnd.y)
    ctx.stroke()
    ctx.strokeStyle = COLORS.cylinderBarrel
    ctx.lineWidth = 0.18
    ctx.beginPath()
    ctx.moveTo(cylinderBase.x, cylinderBase.y)
    ctx.lineTo(barrelEnd.x, barrelEnd.y)
    ctx.stroke()
    this.drawPainted(beam(shoulder, elbow, 0.2), { anchor: shoulder, angle: headingOf(shoulder, elbow) })
    const stickHeading = headingOf(elbow, hammerBack)
    const stickLength = length(sub(hammerBack, elbow))
    const sleeveEnd = add(elbow, scale(normalize(sub(hammerBack, elbow)), Math.min(BOOM.sleeveLength, stickLength)))
    this.drawPainted(beam(sleeveEnd, hammerBack, 0.1), { anchor: sleeveEnd, angle: stickHeading })
    this.drawPainted(beam(elbow, sleeveEnd, 0.17), { anchor: elbow, angle: stickHeading })
    this.drawSteel(
      CHISEL_SHAPE.map((p) => add(rotate(p, angle), pose.chisel)),
      { anchor: pose.chisel, angle },
    )
    this.drawSteel(
      HOUSING_SHAPE.map((p) => add(rotate(p, angle), tip)),
      { anchor: tip, angle },
    )
    for (const joint of [shoulder, elbow]) {
      this.drawPin(joint, 0.2, COLORS.jointFill)
    }
  }

  private drawPin(center: Vec, radius: number, color: string) {
    const ctx = this.context
    const highlight = add(center, scale(LIGHT, radius * 0.4))
    const gradient = ctx.createRadialGradient(highlight.x, highlight.y, 0, center.x, center.y, radius)
    gradient.addColorStop(0, 'rgba(150, 160, 170, 0.9)')
    gradient.addColorStop(0.5, color)
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0.9)')
    ctx.beginPath()
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = gradient
    ctx.fill()
  }

  private drawPourMarker(target: Vec | null) {
    if (!target) {
      return
    }
    const ctx = this.context
    ctx.strokeStyle = 'rgba(143, 179, 209, 0.5)'
    ctx.lineWidth = this.pixels(1.5)
    ctx.beginPath()
    ctx.arc(target.x, target.y, 0.6, 0, Math.PI * 2)
    ctx.stroke()
  }
}

function boundsOf(poly: Vec[]): Bounds {
  const xs = poly.map((p) => p.x)
  const ys = poly.map((p) => p.y)
  return { left: Math.min(...xs), right: Math.max(...xs), bottom: Math.min(...ys), top: Math.max(...ys) }
}

function counterClockwise(poly: Vec[]): Vec[] {
  let twiceSignedArea = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    twiceSignedArea += a.x * b.y - b.x * a.y
  }
  if (twiceSignedArea < 0) {
    return [...poly].reverse()
  }
  return poly
}

function placementMatrix(placement: Placement, metersPerPixel: number): DOMMatrix {
  const cos = Math.cos(placement.angle) * metersPerPixel
  const sin = Math.sin(placement.angle) * metersPerPixel
  return new DOMMatrix([cos, sin, -sin, cos, placement.anchor.x, placement.anchor.y])
}

function headingOf(from: Vec, to: Vec): number {
  return Math.atan2(to.y - from.y, to.x - from.x)
}

function rockColor(rock: Rock): string {
  const { hue, saturation, lightness } = rock.look
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`
}

function toBitmap(source: HTMLCanvasElement): ImageBitmap {
  const copy = new OffscreenCanvas(source.width, source.height)
  copy.getContext('2d')?.drawImage(source, 0, 0)
  return copy.transferToImageBitmap()
}

function vibration(level: number, time: number, phase: number): number {
  if (level < MIN_VISIBLE_SHAKE) {
    return 0
  }
  return level * Math.sin(2 * Math.PI * SHAKE_HZ * time + phase)
}

function turnBetween(from: number, to: number): number {
  const turn = to - from
  return Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)))
}

function addShadedEdges(polygon: Vec[], lit: Path2D, shaded: Path2D, outlines: Path2D) {
  outlines.moveTo(polygon[0].x, polygon[0].y)
  for (let i = 0; i < polygon.length; i++) {
    const from = polygon[i]
    const to = polygon[(i + 1) % polygon.length]
    outlines.lineTo(to.x, to.y)
    const outward = normalize({ x: to.y - from.y, y: from.x - to.x })
    const facing = outward.x * LIGHT.x + outward.y * LIGHT.y
    if (facing > 0.25) {
      lit.moveTo(from.x, from.y)
      lit.lineTo(to.x, to.y)
    }
    if (facing < -0.25) {
      shaded.moveTo(from.x, from.y)
      shaded.lineTo(to.x, to.y)
    }
  }
}

function beam(from: Vec, to: Vec, halfWidth: number): Vec[] {
  const side = scale(perpendicular(normalize(sub(to, from))), halfWidth)
  return [add(from, side), add(to, side), sub(to, side), sub(from, side)]
}

function gridColor(coordinate: number): string {
  if (coordinate % 5 === 0) {
    return COLORS.gridMajor
  }
  return COLORS.grid
}
