import type { ScreenArea } from './render.ts'

export type Dock = 'floating' | 'bottom' | 'left'

const PORTRAIT_ASPECT = 0.8
const SHORT_SCREEN_HEIGHT = 500

export function dockFor(width: number, height: number): Dock {
  if (width / height <= PORTRAIT_ASPECT) {
    return 'bottom'
  }
  if (height <= SHORT_SCREEN_HEIGHT) {
    return 'left'
  }
  return 'floating'
}

export function freeArea(dock: Dock, screen: { width: number; height: number }, panel: HTMLElement): ScreenArea {
  if (dock === 'bottom') {
    return { left: 0, top: 0, width: screen.width, height: screen.height - panel.offsetHeight }
  }
  if (dock === 'left') {
    return { left: panel.offsetWidth, top: 0, width: screen.width - panel.offsetWidth, height: screen.height }
  }
  return { left: 0, top: 0, width: screen.width, height: screen.height }
}
