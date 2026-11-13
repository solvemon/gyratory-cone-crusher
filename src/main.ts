import './style.css'
import { mountDial } from './dial.ts'
import { makeDraggable } from './draggable.ts'
import { dockFor, dustSizeFor, freeArea } from './layout.ts'
import { Average, Pacing } from './pacing.ts'
import type { Dock } from './layout.ts'
import { Renderer } from './render.ts'
import { initPhysics, Sim } from './sim.ts'
import { createGrimeTile, createSteelTile } from './textures.ts'
import { loadSettings, saveSettings } from './settings.ts'
import { CrushedTally } from './tally.ts'
import type { Tool } from './settings.ts'
import { POUR_FLOW_MAX, POUR_FLOW_MIN, STEP_DT } from './tuning.ts'
import type { Vec } from './geometry.ts'

const TOOL_HINTS: Record<Tool, string> = {
  pour: 'Hold to pour rocks into the hopper',
  breaker: 'Move to steer the breaker · hold to hammer',
}

const SLOW_MOTION_SPEED = 0.2
const MAX_STEPS_PER_FRAME = 4

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id)
  if (!found) {
    throw new Error(`Missing #${id}`)
  }
  return found as T
}

function useAsCssTexture(variable: string, tile: HTMLCanvasElement) {
  document.documentElement.style.setProperty(variable, `url(${tile.toDataURL()})`)
}

useAsCssTexture('--steel', createSteelTile())
useAsCssTexture('--grime', createGrimeTile())

await initPhysics()

const canvas = element<HTMLCanvasElement>('view')
const runLamp = element<HTMLSpanElement>('run-lamp')
const startButton = element<HTMLButtonElement>('start')
const stopButton = element<HTMLButtonElement>('stop')
const modeSelector = element<HTMLButtonElement>('mode')
const pourModeLegend = element<HTMLSpanElement>('mode-pour')
const breakerModeLegend = element<HTMLSpanElement>('mode-breaker')
const feedDial = element<HTMLDivElement>('feed')
const feedValue = element<HTMLOutputElement>('feed-value')
const slowLamp = element<HTMLSpanElement>('slow-lamp')
const slowButton = element<HTMLButtonElement>('slow')
const resetButton = element<HTMLButtonElement>('reset')
const crushed = element<HTMLDivElement>('crushed')
const stats = element<HTMLDivElement>('stats')
const hint = element<HTMLDivElement>('hint')
const panel = element<HTMLDivElement>('panel')
const nameplate = element<HTMLDivElement>('panel-nameplate')
const collapseButton = element<HTMLButtonElement>('collapse')
const renderer = new Renderer({
  backdrop: element<HTMLCanvasElement>('backdrop'),
  view: canvas,
  steel: element<HTMLCanvasElement>('steel'),
  tools: element<HTMLCanvasElement>('tools'),
})

let sim = new Sim()
const settings = loadSettings()
let dock: Dock = 'floating'

const refreshPanelPosition = makeDraggable(
  panel,
  [nameplate, element<HTMLDivElement>('panel-hazard')],
  'crusher-panel-position',
  () => dock === 'floating',
)

function applyLayout() {
  const screen = { width: canvas.clientWidth, height: canvas.clientHeight }
  dock = dockFor(screen.width, screen.height)
  panel.dataset.dock = dock
  refreshPanelPosition()
  renderer.resize(freeArea(dock, screen, panel))
  sim.fracturer.dustSize = dustSizeFor(renderer.frame.scale)
}

function setPanelCollapsed(collapsed: boolean) {
  settings.panelCollapsed = collapsed
  panel.classList.toggle('collapsed', collapsed)
  collapseButton.setAttribute('aria-expanded', String(!collapsed))
  collapseButton.setAttribute('aria-label', collapsed ? 'Expand panel' : 'Collapse panel')
  saveSettings(settings)
  applyLayout()
}

nameplate.addEventListener('click', (event) => {
  const onButton = event.target instanceof Element && event.target.closest('#collapse') !== null
  if (onButton || dock !== 'floating') {
    setPanelCollapsed(!settings.panelCollapsed)
  }
})
let pointer: Vec | null = null
let pressed = false
let lastFrame = performance.now()
let pendingTime = 0
let fpsFrames = 0
let fpsSince = performance.now()
const pacing = new Pacing()
const tally = new CrushedTally()
const simulationTime = new Average()
const drawTime = new Average()

function trackPointer(event: PointerEvent) {
  const bounds = canvas.getBoundingClientRect()
  pointer = renderer.screenToWorld(event.clientX - bounds.left, event.clientY - bounds.top)
}

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId)
  trackPointer(event)
  pressed = true
})
canvas.addEventListener('pointermove', trackPointer)
for (const type of ['pointerup', 'pointercancel'] as const) {
  canvas.addEventListener(type, () => {
    pressed = false
  })
}

function setTool(tool: Tool) {
  settings.tool = tool
  modeSelector.classList.toggle('breaker', tool === 'breaker')
  pourModeLegend.classList.toggle('active', tool === 'pour')
  breakerModeLegend.classList.toggle('active', tool === 'breaker')
  hint.textContent = TOOL_HINTS[tool]
  saveSettings(settings)
}

function toggleTool() {
  if (settings.tool === 'pour') {
    setTool('breaker')
    return
  }
  setTool('pour')
}

function setCrusherRunning(running: boolean) {
  settings.crusherRunning = running
  runLamp.classList.toggle('on', running)
  saveSettings(settings)
}

function setSlowMotion(slowMotion: boolean) {
  settings.slowMotion = slowMotion
  slowLamp.classList.toggle('on', slowMotion)
  saveSettings(settings)
}

function reset() {
  sim.free()
  sim = new Sim()
  sim.fracturer.dustSize = dustSizeFor(renderer.frame.scale)
  tally.startSession()
}

function showPourFlow() {
  feedValue.textContent = settings.pourFlow.toFixed(1)
}

mountDial(feedDial, {
  min: POUR_FLOW_MIN,
  max: POUR_FLOW_MAX,
  step: 0.5,
  value: settings.pourFlow,
  onChange: (value) => {
    settings.pourFlow = value
    showPourFlow()
    saveSettings(settings)
  },
})
showPourFlow()
setTool(settings.tool)
setCrusherRunning(settings.crusherRunning)
setSlowMotion(settings.slowMotion)
setPanelCollapsed(settings.panelCollapsed)

startButton.addEventListener('click', () => setCrusherRunning(true))
stopButton.addEventListener('click', () => setCrusherRunning(false))
modeSelector.addEventListener('click', toggleTool)
slowButton.addEventListener('click', () => setSlowMotion(!settings.slowMotion))
resetButton.addEventListener('click', reset)
window.addEventListener('keydown', (event) => {
  if (event.key === 's' || event.key === 'S') {
    setSlowMotion(!settings.slowMotion)
  }
  if (event.key === 'r' || event.key === 'R') {
    reset()
  }
  if (event.key === 'g' || event.key === 'G') {
    setCrusherRunning(!settings.crusherRunning)
  }
  if (event.key === '1') {
    setTool('pour')
  }
  if (event.key === '2') {
    setTool('breaker')
  }
})
window.addEventListener('resize', applyLayout)
window.addEventListener('pagehide', () => tally.save())
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    tally.save()
  }
})
new ResizeObserver(applyLayout).observe(panel)

function simulationSpeed(): number {
  if (settings.slowMotion) {
    return SLOW_MOTION_SPEED
  }
  return 1
}

const volumeFormat = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function showCrushed(now: number) {
  tally.record(sim.crushedVolume(), now)
  const session = volumeFormat.format(tally.session).padStart(13, ' ')
  const lifetime = volumeFormat.format(tally.lifetime).padStart(12, ' ')
  crushed.textContent = `SESSION ${session} m³\nLIFETIME ${lifetime} m³`
}

function updateStats(now: number) {
  fpsFrames++
  const elapsed = now - fpsSince
  if (elapsed < 500) {
    return
  }
  const fps = Math.round((fpsFrames * 1000) / elapsed)
  const rocks = String(sim.rocks.count).padStart(4, ' ')
  const simulationMs = simulationTime.value.toFixed(1).padStart(4, ' ')
  const drawMs = drawTime.value.toFixed(1).padStart(4, ' ')
  stats.textContent = `ROCKS ${rocks}   FPS ${fps}\nSIM ${simulationMs} ms  DRAW ${drawMs} ms`
  fpsFrames = 0
  fpsSince = now
}

function applyControls() {
  sim.pourer.flow = settings.pourFlow
  sim.machine.running = settings.crusherRunning
  sim.pourer.target = null
  sim.breaker.target = null
  sim.breaker.hammering = false
  if (settings.tool === 'pour' && pressed) {
    sim.pourer.target = pointer
  }
  if (settings.tool === 'breaker') {
    sim.breaker.target = pointer
    sim.breaker.hammering = pressed
  }
}

function frame(now: number) {
  const elapsed = Math.min(0.1, (now - lastFrame) / 1000)
  pendingTime += elapsed
  lastFrame = now
  applyControls()
  const simulationStart = performance.now()
  let steps = 0
  while (pendingTime >= STEP_DT && steps < MAX_STEPS_PER_FRAME) {
    sim.step(STEP_DT * simulationSpeed(), pacing.catchUp)
    pendingTime -= STEP_DT
    steps++
  }
  if (steps === MAX_STEPS_PER_FRAME) {
    pendingTime = 0
  }
  pacing.record(elapsed, steps * STEP_DT)
  const drawStart = performance.now()
  simulationTime.add(drawStart - simulationStart)
  renderer.draw(sim, sim.pourer.target)
  drawTime.add(performance.now() - drawStart)
  showCrushed(now)
  updateStats(now)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
