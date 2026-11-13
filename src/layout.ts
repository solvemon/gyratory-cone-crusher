import type { ScreenArea } from './render.ts'
import { DUST_SIZE } from './tuning.ts'

export type Dock = 'floating' | 'bottom' | 'left'

const PORTRAIT_ASPECT = 0.8
const SHORT_SCREEN_HEIGHT = 500
const SMALLEST_VISIBLE_PIECE_PIXELS = 6
const FULL_SAND_DETAIL_PIXELS_PER_METER = 32
const LEAST_SAND_DETAIL = 0.3

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

export function dustSizeFor(pixelsPerMeter: number): number {
  return Math.max(DUST_SIZE, SMALLEST_VISIBLE_PIECE_PIXELS / pixelsPerMeter)
}

export function sandDetailFor(pixelsPerMeter: number): number {
  const detail = (pixelsPerMeter / FULL_SAND_DETAIL_PIXELS_PER_METER) ** 2
  return Math.min(1, Math.max(LEAST_SAND_DETAIL, detail))
}
