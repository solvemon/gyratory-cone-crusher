import { readStored, writeStored } from './storage.ts'

type Position = { x: number; y: number }

const HOME: Position = { x: 12, y: 12 }

function isPosition(value: unknown): value is Position {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return typeof candidate.x === 'number' && typeof candidate.y === 'number'
}

function load(key: string): Position {
  const stored = readStored(key)
  if (isPosition(stored)) {
    return stored
  }
  return HOME
}

export function makeDraggable(panel: HTMLElement, handles: HTMLElement[], storageKey: string) {
  let position = load(storageKey)
  let grab: Position | null = null

  function place(next: Position) {
    const maxX = Math.max(0, window.innerWidth - panel.offsetWidth)
    const maxY = Math.max(0, window.innerHeight - panel.offsetHeight)
    position = { x: Math.min(maxX, Math.max(0, next.x)), y: Math.min(maxY, Math.max(0, next.y)) }
    panel.style.left = `${position.x}px`
    panel.style.top = `${position.y}px`
  }

  for (const handle of handles) {
    handle.addEventListener('pointerdown', (event) => {
      handle.setPointerCapture(event.pointerId)
      grab = { x: event.clientX - position.x, y: event.clientY - position.y }
      panel.classList.add('dragging')
    })
    handle.addEventListener('pointermove', (event) => {
      if (grab) {
        place({ x: event.clientX - grab.x, y: event.clientY - grab.y })
      }
    })
    for (const type of ['pointerup', 'pointercancel'] as const) {
      handle.addEventListener(type, () => {
        grab = null
        panel.classList.remove('dragging')
        writeStored(storageKey, position)
      })
    }
    handle.addEventListener('dblclick', () => {
      place(HOME)
      writeStored(storageKey, position)
    })
  }

  window.addEventListener('resize', () => place(position))
  place(position)
}
