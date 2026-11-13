import { add, length, normalize, perpendicular, rotate, scale, sub } from './geometry.ts'
import { BOOM, CHISEL_SHAPE, HOUSING_LENGTH, HOUSING_SHAPE } from './breaker.ts'
import type { BoomPose } from './breaker.ts'
import type { Vec } from './geometry.ts'
import { ESSENTIAL_VIEW, GROUND_Y, MANTLE_PARTS, PIVOT, STATIC_PARTS, VIEW } from './machine.ts'
import { TRUCK } from './trucks.ts'
import type { Truck } from './trucks.ts'
import type { Rock, RockField } from './rocks.ts'
import type { Sim } from './sim.ts'
import type { Skin } from './skins.ts'
import { createPaintTile, createPuffSprite, createRockTile, createSteelTile } from './textures.ts'

const ROCK_TEXTURE_METERS_PER_PIXEL = 1.6 / 256
const STEEL_TEXTURE_METERS_PER_PIXEL = 5 / 512
const LIGHT = normalize({ x: -0.55, y: 0.85 })
const NO_ROTATION = { anchor: { x: 0, y: 0 }, angle: 0 }
const EDGE_GRIME_STEPS = [1, 0.85, 0.7, 0.56, 0.43, 0.31, 0.2, 0.1]
const MAX_PIXEL_RATIO = 2
const SPRITE_MARGIN_PIXELS = 4
const MANTLE_AXIS_LENGTH = 15
const TRUCK_BODY_BOUNDS = { left: -4.0, right: 6.3, bottom: 0.4, top: 5.0 }
const WHEEL_BOUNDS = { left: -1.45, right: 1.45, bottom: -1.45, top: 1.45 }
const TRUCK_PAINTED_PARTS: Vec[][] = [
  [{ x: -3.75, y: 4.3 }, { x: -3.15, y: 2.05 }, { x: 3.2, y: 2.05 }, { x: 3.5, y: 4.45 }],
  [{ x: 3.6, y: 2.05 }, { x: 5.3, y: 2.05 }, { x: 5.3, y: 4.25 }, { x: 3.6, y: 4.25 }],
  [{ x: 3.2, y: 4.25 }, { x: 5.6, y: 4.25 }, { x: 5.6, y: 4.5 }, { x: 3.4, y: 4.6 }],
  [{ x: 5.3, y: 1.5 }, { x: 6.05, y: 1.5 }, { x: 6.05, y: 3.1 }, { x: 5.3, y: 3.4 }],
]
const TRUCK_FRAME: Vec[] = [
  { x: -3.2, y: 2.1 },
  { x: -3.2, y: 1.8 },
  { x: -2.7, y: 1.45 },
  { x: 5.2, y: 1.45 },
  { x: 5.7, y: 1.7 },
  { x: 5.7, y: 2.1 },
]
const UNDER_SHADOW = { left: -2.6, right: 5.4, bottom: 0.95, top: 1.5 }
const FUEL_TANK = { left: 0.75, right: 2.75, bottom: 0.85, top: 1.55 }
const MUD_FLAP = { left: -2.75, right: -2.55, bottom: 0.5, top: 2.05 }
const WELL_CLEARANCE = 0.16
const FRONT_FENDER = { inner: 1.55, outer: 1.85, from: 0.15, to: 2.75 }
const REAR_ARCH = { inner: 1.55, outer: 1.72, from: 0.35, to: 2.8 }
const TRUCK_WINDOW: Vec[] = [{ x: 4.2, y: 3.2 }, { x: 5.15, y: 3.2 }, { x: 5.15, y: 4.1 }, { x: 4.05, y: 4.1 }]
const LOAD_LEFT = -3.45
const LOAD_RIGHT = 3.25
const LOAD_PEAK_X = -0.2
const TIRE_LUGS = 22
const SKIN_GRIT = 0.3
const SAND_MIN_PIXELS = 1.6
const SAND_COLORS = ['rgb(190, 174, 152)', 'rgb(152, 138, 120)', 'rgb(116, 104, 90)']
const TIRE_SQUISH = 0.12
const BEACON_HALO_RADIUS = 1.6
const FUME_OPACITY = 0.1
const BEACON_FLASH_HZ = 1.4
const REBAKE_TURN = 0.35
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
  road: '#1c1916',
  load: 'hsl(32, 12%, 52%)',
  roadEdge: 'rgba(214, 196, 170, 0.22)',
  truckChassis: '#25272a',
  truckGlass: '#161b21',
  truckTrim: 'rgba(30, 24, 10, 0.55)',
  tire: '#1a1b1c',
  tireLug: '#0c0d0e',
  rimSteel: '#3b3f43',
  wheelWell: 'rgba(10, 10, 11, 0.94)',
  underShadow: 'rgba(0, 0, 0, 0.45)',
  fuelTank: '#2d3034',
  mudFlap: '#151617',
  beacon: '255, 170, 40',
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
  fumeSprite: ImageBitmap
  private viewContext: CanvasRenderingContext2D
  private mantleSprite: Sprite | null = null
  private truckBody: Sprite | null = null
  private truckWheel: Sprite | null = null
  private toolsSignature = ''
  private rockSprites = new Map<Rock, RockSprite>()
  private skinPatterns = new WeakMap<Skin, CanvasPattern>()
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
    this.fumeSprite = toBitmap(createPuffSprite('62, 64, 66'))
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

  draw(sim: Sim, pourTarget: Vec | null) {
    const ctx = this.viewContext
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
    this.useWorldTransform()
    this.drawSand(sim)
    this.drawRocks(sim)
    this.drawPuffs(sim)
    this.drawSparks(sim)
    this.drawMantleSprite(sim.machine.angle)
    this.drawTrucks(sim)
    this.drawFumes(sim)
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
    this.truckBody?.image.close()
    this.truckBody = this.paintSprite(TRUCK_BODY_BOUNDS, () => this.drawTruckBody())
    this.truckWheel?.image.close()
    this.truckWheel = this.paintSprite(WHEEL_BOUNDS, () => this.drawTruckWheel())
    this.toolsSignature = ''
  }

  private paintMantleSprite(): Sprite {
    const outline = boundsOf(MANTLE_PARTS.flat())
    const world = { ...outline, bottom: Math.min(outline.bottom, PIVOT.y - MANTLE_AXIS_LENGTH) }
    return this.paintSprite(world, () => this.drawMantle(0))
  }

  private paintSprite(world: Bounds, paint: () => void): Sprite {
    const { scale, dpr } = this.frame
    const margin = SPRITE_MARGIN_PIXELS
    const width = (world.right - world.left) * scale + margin * 2
    const height = (world.top - world.bottom) * scale + margin * 2
    const sprite = this.bakeSprite(width, height)
    sprite.setTransform(scale * dpr, 0, 0, -scale * dpr, (margin - world.left * scale) * dpr, (margin + world.top * scale) * dpr)
    this.context = sprite
    paint()
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

  private drawSprite(sprite: Sprite, origin: Vec, pivot: Vec, angle: number) {
    const ctx = this.viewContext
    const { scale, originX, originY, dpr } = this.frame
    const pivotX = originX + (origin.x + pivot.x) * scale
    const pivotY = originY - (origin.y + pivot.y) * scale
    const left = (sprite.world.left - pivot.x) * scale - sprite.margin
    const top = -(sprite.world.top - pivot.y) * scale - sprite.margin
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.translate(pivotX, pivotY)
    ctx.rotate(-angle)
    ctx.drawImage(sprite.image, left, top, sprite.width, sprite.height)
    this.useWorldTransform()
  }

  private drawMantleSprite(angle: number) {
    if (this.mantleSprite) {
      this.drawSprite(this.mantleSprite, { x: 0, y: 0 }, PIVOT, angle)
    }
  }

  private drawTrucks(sim: Sim) {
    for (const truck of sim.trucks.trucks) {
      const left = truck.x + TRUCK_BODY_BOUNDS.left
      const right = truck.x + TRUCK_BODY_BOUNDS.right
      if (right < this.visible.left || left > this.visible.right) {
        continue
      }
      this.drawTruck(truck, sim.time)
    }
  }

  private drawTruck(truck: Truck, time: number) {
    const body = { x: truck.x, y: GROUND_Y + truck.sag }
    if (truck.visibleHeap > 0) {
      this.inTruckFrame(truck, () => this.drawLoad(truck))
    }
    if (this.truckBody) {
      this.drawSprite(this.truckBody, body, TRUCK.pitchPivot, truck.pitch)
    }
    if (this.truckWheel) {
      for (const wheel of TRUCK.wheels) {
        this.drawSprite(this.truckWheel, { x: truck.x + wheel.x, y: GROUND_Y + wheel.y - TIRE_SQUISH }, { x: 0, y: 0 }, truck.wheelTurn)
      }
    }
    if (truck.full) {
      this.inTruckFrame(truck, () => this.drawBeacon(time))
    }
  }

  private inTruckFrame(truck: Truck, draw: () => void) {
    const ctx = this.viewContext
    const pivot = TRUCK.pitchPivot
    this.useWorldTransform()
    ctx.translate(truck.x + pivot.x, GROUND_Y + truck.sag + pivot.y)
    ctx.rotate(truck.pitch)
    ctx.translate(-pivot.x, -pivot.y)
    draw()
    this.useWorldTransform()
  }

  private drawLoad(truck: Truck) {
    const ctx = this.viewContext
    const height = truck.visibleHeap
    const seed = truck.body.handle
    const mound: Vec[] = [{ x: LOAD_LEFT, y: TRUCK.rimY - 0.05 }]
    for (let x = LOAD_LEFT + 0.3; x < LOAD_RIGHT; x += 0.35) {
      const across = (x - LOAD_PEAK_X) / (LOAD_RIGHT - LOAD_LEFT)
      const shape = Math.max(0, 1 - 3.2 * across * across)
      const lumps = 0.07 * Math.sin(x * 3.7 + seed) + 0.05 * Math.sin(x * 7.3 + seed * 2.1)
      mound.push({ x, y: TRUCK.rimY + height * shape + lumps * Math.min(1, height * 3) })
    }
    mound.push({ x: LOAD_RIGHT, y: TRUCK.rimY - 0.05 })
    this.tracePolygon(mound)
    ctx.fillStyle = COLORS.load
    ctx.fill()
    this.rockTexture.setTransform(placementMatrix({ anchor: { x: seed * 3.1, y: 0 }, angle: 0.4 }, ROCK_TEXTURE_METERS_PER_PIXEL * 0.7))
    ctx.globalCompositeOperation = 'overlay'
    ctx.fillStyle = this.rockTexture
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = COLORS.rockOutline
    ctx.lineWidth = this.pixels(1)
    ctx.stroke()
  }

  private drawBeacon(time: number) {
    const ctx = this.viewContext
    const { x, y } = TRUCK.beacon
    const glow = flash(time)
    ctx.fillStyle = `rgba(${COLORS.beacon}, ${0.55 + 0.45 * glow})`
    ctx.beginPath()
    ctx.arc(x, y + 0.12, 0.15, 0, Math.PI * 2)
    ctx.fill()
    const halo = ctx.createRadialGradient(x, y + 0.12, 0, x, y + 0.12, BEACON_HALO_RADIUS)
    halo.addColorStop(0, `rgba(${COLORS.beacon}, ${0.55 * glow})`)
    halo.addColorStop(1, `rgba(${COLORS.beacon}, 0)`)
    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = halo
    ctx.fillRect(x - BEACON_HALO_RADIUS, y + 0.12 - BEACON_HALO_RADIUS, BEACON_HALO_RADIUS * 2, BEACON_HALO_RADIUS * 2)
    ctx.globalCompositeOperation = 'source-over'
  }

  private drawFumes(sim: Sim) {
    const ctx = this.viewContext
    for (const fume of sim.effects.fumes) {
      const progress = fume.age / fume.life
      const fadeIn = Math.min(1, progress * 5)
      ctx.globalAlpha = FUME_OPACITY * fadeIn * (1 - progress)
      ctx.drawImage(this.fumeSprite, fume.x - fume.radius, fume.y - fume.radius, fume.radius * 2, fume.radius * 2)
    }
    ctx.globalAlpha = 1
  }

  private drawTruckBody() {
    const ctx = this.context
    this.drawUnderChassis()
    this.drawSteel([{ x: 5.85, y: 0.95 }, { x: 6.0, y: 0.95 }, { x: 5.6, y: 3.1 }, { x: 5.45, y: 3.1 }])
    for (const part of TRUCK_PAINTED_PARTS) {
      this.drawPainted(part, NO_ROTATION)
    }
    this.drawWheelArches()
    ctx.lineCap = 'round'
    ctx.strokeStyle = COLORS.truckTrim
    ctx.lineWidth = 0.09
    for (const x of [-2.3, -0.8, 0.7, 2.2]) {
      ctx.beginPath()
      ctx.moveTo(x - 0.05, 2.15)
      ctx.lineTo(x + 0.02, 4.2)
      ctx.stroke()
    }
    ctx.lineWidth = 0.14
    ctx.beginPath()
    ctx.moveTo(-3.72, 4.28)
    ctx.lineTo(3.48, 4.43)
    ctx.stroke()
    ctx.fillStyle = COLORS.truckGlass
    this.tracePolygon(TRUCK_WINDOW)
    ctx.fill()
    ctx.strokeStyle = 'rgba(200, 215, 230, 0.18)'
    ctx.lineWidth = this.pixels(1.5)
    ctx.beginPath()
    ctx.moveTo(4.3, 3.35)
    ctx.lineTo(4.75, 4.0)
    ctx.stroke()
    ctx.strokeStyle = COLORS.truckTrim
    ctx.lineWidth = 0.05
    for (const y of [1.8, 2.1, 2.4, 2.7]) {
      ctx.beginPath()
      ctx.moveTo(5.75, y)
      ctx.lineTo(6.0, y)
      ctx.stroke()
    }
    ctx.strokeStyle = COLORS.truckChassis
    ctx.lineWidth = 0.16
    ctx.beginPath()
    ctx.moveTo(TRUCK.stackTop.x, 3.0)
    ctx.lineTo(TRUCK.stackTop.x, TRUCK.stackTop.y)
    ctx.stroke()
    ctx.lineWidth = 0.06
    ctx.beginPath()
    ctx.moveTo(5.3, 3.9)
    ctx.lineTo(6.05, 3.9)
    ctx.moveTo(5.4, 3.35)
    ctx.lineTo(5.4, 3.9)
    ctx.moveTo(6.0, 3.1)
    ctx.lineTo(6.0, 3.9)
    ctx.stroke()
    ctx.fillStyle = COLORS.truckChassis
    ctx.fillRect(TRUCK.beacon.x - 0.16, TRUCK.beacon.y - 0.05, 0.32, 0.1)
  }

  private drawUnderChassis() {
    const ctx = this.context
    ctx.fillStyle = COLORS.underShadow
    fillBox(ctx, UNDER_SHADOW)
    ctx.fillStyle = COLORS.fuelTank
    ctx.beginPath()
    ctx.roundRect(FUEL_TANK.left, FUEL_TANK.bottom, FUEL_TANK.right - FUEL_TANK.left, FUEL_TANK.top - FUEL_TANK.bottom, 0.18)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.lineWidth = 0.06
    for (const x of [1.25, 2.25]) {
      ctx.beginPath()
      ctx.moveTo(x, FUEL_TANK.bottom)
      ctx.lineTo(x, FUEL_TANK.top)
      ctx.stroke()
    }
    ctx.strokeStyle = 'rgba(210, 220, 230, 0.12)'
    ctx.lineWidth = this.pixels(1)
    ctx.beginPath()
    ctx.moveTo(FUEL_TANK.left + 0.15, FUEL_TANK.top - 0.08)
    ctx.lineTo(FUEL_TANK.right - 0.15, FUEL_TANK.top - 0.08)
    ctx.stroke()
    ctx.fillStyle = COLORS.truckChassis
    this.tracePolygon(TRUCK_FRAME)
    ctx.fill()
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)'
    ctx.lineWidth = this.pixels(1)
    ctx.stroke()
    ctx.fillStyle = COLORS.mudFlap
    fillBox(ctx, MUD_FLAP)
  }

  private drawWheelArches() {
    const ctx = this.context
    const radius = TRUCK.wheelRadius + WELL_CLEARANCE
    ctx.fillStyle = COLORS.wheelWell
    for (const wheel of TRUCK.wheels) {
      ctx.beginPath()
      ctx.arc(wheel.x, wheel.y, radius, 0, Math.PI)
      ctx.closePath()
      ctx.fill()
    }
    const [rear, front] = TRUCK.wheels
    this.drawPainted(arcBand(front, FRONT_FENDER), NO_ROTATION)
    this.drawPainted(arcBand(rear, REAR_ARCH), NO_ROTATION)
  }

  private drawTruckWheel() {
    const ctx = this.context
    const radius = TRUCK.wheelRadius
    const tire = ctx.createRadialGradient(0, 0, radius * 0.5, 0, 0, radius)
    tire.addColorStop(0, '#2c2e30')
    tire.addColorStop(1, COLORS.tire)
    ctx.fillStyle = tire
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = COLORS.tireLug
    ctx.lineWidth = 0.13
    for (let i = 0; i < TIRE_LUGS; i++) {
      const angle = (i / TIRE_LUGS) * Math.PI * 2
      ctx.beginPath()
      ctx.moveTo(Math.cos(angle) * radius * 0.86, Math.sin(angle) * radius * 0.86)
      ctx.lineTo(Math.cos(angle + 0.06) * radius, Math.sin(angle + 0.06) * radius)
      ctx.stroke()
    }
    this.rockTexture.setTransform(placementMatrix({ anchor: { x: 7, y: 3 }, angle: 0 }, ROCK_TEXTURE_METERS_PER_PIXEL))
    ctx.globalCompositeOperation = 'overlay'
    ctx.globalAlpha = 0.5
    ctx.fillStyle = this.rockTexture
    ctx.beginPath()
    ctx.arc(0, 0, radius, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)'
    ctx.lineWidth = 0.05
    ctx.beginPath()
    ctx.arc(0, 0, radius * 0.78, 0, Math.PI * 2)
    ctx.stroke()
    this.steelTexture.setTransform(placementMatrix(NO_ROTATION, STEEL_TEXTURE_METERS_PER_PIXEL))
    ctx.fillStyle = this.steelTexture
    ctx.beginPath()
    ctx.arc(0, 0, radius * 0.52, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'
    ctx.fill()
    ctx.fillStyle = COLORS.rimSteel
    for (let i = 0; i < 10; i++) {
      const angle = (i / 10) * Math.PI * 2
      ctx.beginPath()
      ctx.arc(Math.cos(angle) * radius * 0.36, Math.sin(angle) * radius * 0.36, 0.05, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = COLORS.truckChassis
    ctx.beginPath()
    ctx.arc(0, 0, radius * 0.16, 0, Math.PI * 2)
    ctx.fill()
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

  private drawRocks(sim: Sim) {
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
    const texture = rocks.textureFrame(rock)
    const placement = { anchor: sub(texture.anchor, rock.body.translation()), angle: texture.angle }
    if (rock.skin) {
      this.paintSkin(ctx, rock.skin, placement)
    } else {
      ctx.fillStyle = rockColor(rock)
      ctx.fill()
    }
    this.rockTexture.setTransform(placementMatrix(placement, ROCK_TEXTURE_METERS_PER_PIXEL))
    ctx.globalCompositeOperation = 'overlay'
    ctx.globalAlpha = rock.skin ? SKIN_GRIT : 1
    ctx.fillStyle = this.rockTexture
    ctx.fill()
    ctx.globalAlpha = 1
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

  private paintSkin(ctx: Context2D, skin: Skin, placement: Placement) {
    ctx.fillStyle = skin.base
    ctx.fill()
    const pattern = this.skinPattern(skin)
    pattern.setTransform(imageMatrix(placement, skin.width / skin.source.width))
    ctx.fillStyle = pattern
    ctx.fill()
  }

  private skinPattern(skin: Skin): CanvasPattern {
    const cached = this.skinPatterns.get(skin)
    if (cached) {
      return cached
    }
    const pattern = this.viewContext.createPattern(skin.source, 'no-repeat')
    if (!pattern) {
      throw new Error('Could not create picture pattern')
    }
    this.skinPatterns.set(skin, pattern)
    return pattern
  }

  private drawSand(sim: Sim) {
    const ctx = this.viewContext
    const sand = sim.effects.sand
    const smallest = SAND_MIN_PIXELS / this.frame.scale
    for (let shade = 0; shade < SAND_COLORS.length; shade++) {
      ctx.beginPath()
      for (let i = 0; i < sand.count; i++) {
        if (sand.shade[i] !== shade) {
          continue
        }
        const size = Math.max(sand.size[i], smallest)
        ctx.rect(sand.x[i] - size / 2, sand.y[i] - size / 2, size, size)
      }
      ctx.fillStyle = SAND_COLORS[shade]
      ctx.fill()
    }
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
    this.drawRoad()
  }

  private drawRoad() {
    const ctx = this.context
    const { left, right, bottom } = this.visible
    ctx.fillStyle = COLORS.road
    ctx.fillRect(left, bottom, right - left, GROUND_Y - bottom)
    this.rockTexture.setTransform(placementMatrix(NO_ROTATION, ROCK_TEXTURE_METERS_PER_PIXEL))
    ctx.globalAlpha = 0.35
    ctx.globalCompositeOperation = 'overlay'
    ctx.fillStyle = this.rockTexture
    ctx.fillRect(left, bottom, right - left, GROUND_Y - bottom)
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 1
    ctx.strokeStyle = COLORS.roadEdge
    ctx.lineWidth = this.pixels(1.5)
    ctx.beginPath()
    ctx.moveTo(left, GROUND_Y)
    ctx.lineTo(right, GROUND_Y)
    ctx.stroke()
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

function imageMatrix(placement: Placement, metersPerPixel: number): DOMMatrix {
  const cos = Math.cos(placement.angle) * metersPerPixel
  const sin = Math.sin(placement.angle) * metersPerPixel
  return new DOMMatrix([cos, sin, sin, -cos, placement.anchor.x, placement.anchor.y])
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

function fillBox(ctx: Context2D, box: Bounds) {
  ctx.fillRect(box.left, box.bottom, box.right - box.left, box.top - box.bottom)
}

function arcBand(center: Vec, band: { inner: number; outer: number; from: number; to: number }): Vec[] {
  const steps = 14
  const outer: Vec[] = []
  const inner: Vec[] = []
  for (let i = 0; i <= steps; i++) {
    const angle = band.from + ((band.to - band.from) * i) / steps
    outer.push({ x: center.x + Math.cos(angle) * band.outer, y: center.y + Math.sin(angle) * band.outer })
    inner.push({ x: center.x + Math.cos(angle) * band.inner, y: center.y + Math.sin(angle) * band.inner })
  }
  return outer.concat(inner.reverse())
}

function flash(time: number): number {
  return Math.max(0, Math.sin(time * 2 * Math.PI * BEACON_FLASH_HZ)) ** 2
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
