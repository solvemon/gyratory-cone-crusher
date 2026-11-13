import './style.css'
import { mountDial } from './dial.ts'
import { makeDraggable } from './draggable.ts'
import { dockFor, dustSizeFor, freeArea, sandDetailFor } from './layout.ts'
import { Average, Pacing } from './pacing.ts'
import type { Dock } from './layout.ts'
import { Renderer } from './render.ts'
import { initPhysics, Sim } from './sim.ts'
import { createGrimeTile, createSteelTile } from './textures.ts'
import { loadSettings, saveSettings } from './settings.ts'
import { CrushedTally } from './tally.ts'
import { problemSheet, skinFromImage } from './skins.ts'
import { forgetProblem, loadOwnProblems, PROBLEM_SUGGESTIONS, rememberProblem } from './problems.ts'
import type { Tool } from './settings.ts'
import { POUR_FLOW_MAX, POUR_FLOW_MIN, STEP_DT } from './tuning.ts'
import type { Vec } from './geometry.ts'

const TOOL_HINTS: Record<Tool, string> = {
  pour: 'Hold to pour rocks into the hopper',
  breaker: 'Move to steer the breaker · hold to hammer',
}

const TRUCK_FULL_HINT = 'Truck full · tap it to send it off'

const PASTED_TEXT_LIMIT = 80
const SUGGESTION_SECONDS = 2.5

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
const dispatchSelector = element<HTMLButtonElement>('dispatch')
const manualDispatchLegend = element<HTMLSpanElement>('dispatch-manual')
const autoDispatchLegend = element<HTMLSpanElement>('dispatch-auto')
const truckLamp = element<HTMLSpanElement>('truck-lamp')
const feedLamp = element<HTMLSpanElement>('feed-lamp')
const autoFeedButton = element<HTMLButtonElement>('auto-feed')
const solver = element<HTMLDivElement>('solver')
const solverToggle = element<HTMLButtonElement>('solver-toggle')
const problemList = element<HTMLDivElement>('problems')
const problemForm = element<HTMLFormElement>('problem-form')
const problemText = element<HTMLInputElement>('problem-text')
const picturePick = element<HTMLButtonElement>('picture-pick')
const pictureFile = element<HTMLInputElement>('picture-file')
const feedDial = element<HTMLDivElement>('feed')
const feedValue = element<HTMLOutputElement>('feed-value')
const resetButton = element<HTMLButtonElement>('reset')
const crushed = element<HTMLDivElement>('crushed')
const stats = element<HTMLDivElement>('stats')
const hint = element<HTMLDivElement>('hint')
const pasteHint = element<HTMLDivElement>('paste-hint')
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

function matchDetailToScreen() {
  sim.fracturer.dustSize = dustSizeFor(renderer.frame.scale)
  sim.effects.sand.detail = sandDetailFor(renderer.frame.scale)
}

function applyLayout() {
  const screen = { width: canvas.clientWidth, height: canvas.clientHeight }
  dock = dockFor(screen.width, screen.height)
  panel.dataset.dock = dock
  refreshPanelPosition()
  renderer.resize(freeArea(dock, screen, panel))
  matchDetailToScreen()
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

function overParkedTruck(): boolean {
  return pointer !== null && sim.trucks.parkedAt(pointer) !== null
}

canvas.addEventListener('pointerdown', (event) => {
  trackPointer(event)
  if (pointer && sim.trucks.dispatch(pointer)) {
    return
  }
  canvas.setPointerCapture(event.pointerId)
  pressed = true
})
canvas.addEventListener('pointermove', (event) => {
  trackPointer(event)
  canvas.classList.toggle('over-truck', !pressed && overParkedTruck())
})
for (const type of ['pointerup', 'pointercancel'] as const) {
  canvas.addEventListener(type, () => {
    pressed = false
  })
}

function setTool(tool: Tool) {
  settings.tool = tool
  modeSelector.classList.toggle('turned', tool === 'breaker')
  pourModeLegend.classList.toggle('active', tool === 'pour')
  breakerModeLegend.classList.toggle('active', tool === 'breaker')
  showHint()
  saveSettings(settings)
}

function setAutoFeed(autoFeed: boolean) {
  settings.autoFeed = autoFeed
  feedLamp.classList.toggle('on', autoFeed)
  saveSettings(settings)
}

function setSolverOpen(open: boolean) {
  settings.solverOpen = open
  solver.classList.toggle('closed', !open)
  solverToggle.setAttribute('aria-expanded', String(open))
  saveSettings(settings)
}

function crushProblem(text: string) {
  const problem = text.trim()
  if (problem) {
    sim.pourer.throwIn(problemSheet(problem))
  }
}

async function crushPicture(file: File, x: number | null) {
  if (!file.type.startsWith('image/')) {
    return
  }
  try {
    const bitmap = await createImageBitmap(file)
    sim.pourer.throwIn(skinFromImage(bitmap), x)
    bitmap.close()
  } catch {
    hint.textContent = 'That picture could not be read'
  }
}

function shortened(text: string): string {
  if (text.length <= PASTED_TEXT_LIMIT) {
    return text
  }
  return `${text.slice(0, PASTED_TEXT_LIMIT - 1).trimEnd()}…`
}

function firstImage(files: FileList | null | undefined): File | null {
  const images = Array.from(files ?? []).filter((file) => file.type.startsWith('image/'))
  return images[0] ?? null
}

function setAutoDispatch(auto: boolean) {
  settings.autoDispatch = auto
  dispatchSelector.classList.toggle('turned', auto)
  manualDispatchLegend.classList.toggle('active', !auto)
  autoDispatchLegend.classList.toggle('active', auto)
  saveSettings(settings)
}

function dockedTruckIsFull(): boolean {
  const docked = sim.trucks.docked
  return docked !== null && docked.full
}

function showHint() {
  if (dockedTruckIsFull() && !settings.autoDispatch) {
    hint.textContent = TRUCK_FULL_HINT
    return
  }
  hint.textContent = TOOL_HINTS[settings.tool]
}

function showPasteHint() {
  const pasteKey = /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd' : 'Ctrl'
  pasteHint.textContent = `Paste to crush · ${pasteKey}-V`
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

function reset() {
  sim.free()
  sim = new Sim()
  matchDetailToScreen()
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
showPasteHint()
setTool(settings.tool)
setCrusherRunning(settings.crusherRunning)
setPanelCollapsed(settings.panelCollapsed)
setAutoDispatch(settings.autoDispatch)
setSolverOpen(settings.solverOpen)
setAutoFeed(settings.autoFeed)
autoFeedButton.addEventListener('click', () => setAutoFeed(!settings.autoFeed))

let ownProblems = loadOwnProblems()

let suggestionIndex = 0

function showSuggestion() {
  problemText.placeholder = PROBLEM_SUGGESTIONS[suggestionIndex]
}

function advanceSuggestion() {
  suggestionIndex = (suggestionIndex + 1) % PROBLEM_SUGGESTIONS.length
  showSuggestion()
}

function ownProblemKey(problem: string): HTMLSpanElement {
  const group = document.createElement('span')
  group.className = 'key-group'
  const key = document.createElement('button')
  key.type = 'button'
  key.className = 'key own'
  key.textContent = problem
  key.addEventListener('click', () => crushProblem(problem))
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'key own remove'
  remove.textContent = '×'
  remove.setAttribute('aria-label', `Forget ${problem}`)
  remove.addEventListener('click', () => {
    ownProblems = forgetProblem(ownProblems, problem)
    showProblemKeys()
  })
  group.append(key, remove)
  return group
}

function showProblemKeys() {
  problemList.replaceChildren(...ownProblems.map(ownProblemKey))
}

showProblemKeys()
showSuggestion()
window.setInterval(advanceSuggestion, SUGGESTION_SECONDS * 1000)
solverToggle.addEventListener('click', () => setSolverOpen(!settings.solverOpen))
problemForm.addEventListener('submit', (event) => {
  event.preventDefault()
  let problem = problemText.value.trim()
  problemText.value = ''
  if (!problem) {
    problem = PROBLEM_SUGGESTIONS[suggestionIndex]
  }
  crushProblem(problem)
  ownProblems = rememberProblem(ownProblems, problem)
  showProblemKeys()
})
picturePick.addEventListener('click', () => pictureFile.click())
pictureFile.addEventListener('change', () => {
  const file = firstImage(pictureFile.files)
  if (file) {
    crushPicture(file, null)
  }
  pictureFile.value = ''
})
window.addEventListener('dragover', (event) => {
  event.preventDefault()
})
window.addEventListener('drop', (event) => {
  event.preventDefault()
  const file = firstImage(event.dataTransfer?.files)
  if (!file) {
    return
  }
  const bounds = canvas.getBoundingClientRect()
  const dropped = renderer.screenToWorld(event.clientX - bounds.left, event.clientY - bounds.top)
  crushPicture(file, dropped.x)
})
window.addEventListener('paste', (event) => {
  const clipboard = event.clipboardData
  if (event.target instanceof HTMLInputElement || !clipboard) {
    return
  }
  const file = firstImage(clipboard.files)
  if (file) {
    event.preventDefault()
    crushPicture(file, null)
    return
  }
  const text = clipboard.getData('text/plain').replace(/\s+/g, ' ').trim()
  if (text) {
    event.preventDefault()
    crushProblem(shortened(text))
  }
})

startButton.addEventListener('click', () => setCrusherRunning(true))
stopButton.addEventListener('click', () => setCrusherRunning(false))
modeSelector.addEventListener('click', toggleTool)
dispatchSelector.addEventListener('click', () => setAutoDispatch(!settings.autoDispatch))
resetButton.addEventListener('click', reset)
window.addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement) {
    return
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
  if (event.key === 'f' || event.key === 'F') {
    setAutoFeed(!settings.autoFeed)
  }
  if (event.key === 't' || event.key === 'T') {
    setAutoDispatch(!settings.autoDispatch)
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
  showHint()
  fpsFrames = 0
  fpsSince = now
}

function applyControls() {
  sim.pourer.flow = settings.pourFlow
  sim.trucks.autoDispatch = settings.autoDispatch
  sim.pourer.autoFeed = settings.autoFeed
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
    sim.step(STEP_DT, pacing.catchUp)
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
  truckLamp.classList.toggle('on', dockedTruckIsFull())
  updateStats(now)
  requestAnimationFrame(frame)
}

requestAnimationFrame(frame)
