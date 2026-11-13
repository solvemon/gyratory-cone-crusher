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

function startsOnButton(event: PointerEvent): boolean {
  return event.target instanceof Element && event.target.closest('button') !== null
}

export function makeDraggable(panel: HTMLElement, handles: HTMLElement[], storageKey: string, isFloating: () => boolean) {
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
      if (!isFloating() || startsOnButton(event)) {
        return
      }
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
        if (!grab) {
          return
        }
        grab = null
        panel.classList.remove('dragging')
        writeStored(storageKey, position)
      })
    }
    handle.addEventListener('dblclick', () => {
      if (!isFloating()) {
        return
      }
      place(HOME)
      writeStored(storageKey, position)
    })
  }

  return function refresh() {
    if (isFloating()) {
      place(position)
      return
    }
    panel.style.left = ''
    panel.style.top = ''
  }
}
