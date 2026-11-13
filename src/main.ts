import './style.css'
import { mountDial } from './dial.ts'
import { makeDraggable } from './draggable.ts'
import { Renderer } from './render.ts'
import { initPhysics, Sim } from './sim.ts'
import { createGrimeTile, createSteelTile } from './textures.ts'
import { loadSettings, saveSettings } from './settings.ts'
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
const loadToggle = element<HTMLInputElement>('load')
const stats = element<HTMLDivElement>('stats')
const hint = element<HTMLDivElement>('hint')
const renderer = new Renderer(canvas)

makeDraggable(
  element<HTMLDivElement>('panel'),
  [element<HTMLDivElement>('panel-nameplate'), element<HTMLDivElement>('panel-hazard')],
  'crusher-panel-position',
)

let sim = new Sim()
const settings = loadSettings()
let pointer: Vec | null = null
let pressed = false
let lastFrame = performance.now()
let pendingTime = 0
let fpsFrames = 0
let fpsSince = performance.now()

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

function setLoadGlow(loadGlow: boolean) {
  settings.loadGlow = loadGlow
  loadToggle.checked = loadGlow
  saveSettings(settings)
}

function reset() {
  sim.free()
  sim = new Sim()
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
setLoadGlow(settings.loadGlow)

startButton.addEventListener('click', () => setCrusherRunning(true))
stopButton.addEventListener('click', () => setCrusherRunning(false))
modeSelector.addEventListener('click', toggleTool)
slowButton.addEventListener('click', () => setSlowMotion(!settings.slowMotion))
loadToggle.addEventListener('change', () => setLoadGlow(loadToggle.checked))
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
window.addEventListener('resize', () => renderer.resize())

function simulationSpeed(): number {
  if (settings.slowMotion) {
    return SLOW_MOTION_SPEED
  }
  return 1
}

function updateStats(now: number) {
  fpsFrames++
  const elapsed = now - fpsSince
  if (elapsed < 500) {
    return
  }
  const fps = Math.round((fpsFrames * 1000) / elapsed)
  stats.textContent = `ROCKS ${String(sim.rocks.count).padStart(4, ' ')}   FPS ${fps}`
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
  pendingTime += Math.min(0.1, (now - lastFrame) / 1000)
  lastFrame = now
  applyControls()
  let steps = 0
  while (pendingTime >= STEP_DT && steps < MAX_STEPS_PER_FRAME) {
    sim.step(STEP_DT * simulationSpeed())
    pendingTime -= STEP_DT
    steps++
  }
  if (steps === MAX_STEPS_PER_FRAME) {
    pendingTime = 0
  }
  renderer.draw(sim, sim.pourer.target, settings.loadGlow)
  updateStats(now)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
