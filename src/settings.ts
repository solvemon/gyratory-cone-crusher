import { readStored, writeStored } from './storage.ts'
import { POUR_FLOW_DEFAULT, POUR_FLOW_MAX, POUR_FLOW_MIN } from './tuning.ts'

export type Tool = 'pour' | 'breaker'

export type Settings = {
  crusherRunning: boolean
  pourFlow: number
  tool: Tool
  slowMotion: boolean
  panelCollapsed: boolean
  autoDispatch: boolean
}

const STORAGE_KEY = 'crusher-settings'

const DEFAULTS: Settings = {
  crusherRunning: true,
  pourFlow: POUR_FLOW_DEFAULT,
  tool: 'pour',
  slowMotion: false,
  panelCollapsed: false,
  autoDispatch: false,
}

function storedField<T>(stored: Record<string, unknown>, key: keyof Settings, isValid: (value: unknown) => boolean): T {
  const value = stored[key]
  if (isValid(value)) {
    return value as T
  }
  return DEFAULTS[key] as T
}

const isBoolean = (value: unknown) => typeof value === 'boolean'
const isFlow = (value: unknown) => typeof value === 'number' && value >= POUR_FLOW_MIN && value <= POUR_FLOW_MAX
const isTool = (value: unknown) => value === 'pour' || value === 'breaker'

export function loadSettings(): Settings {
  const stored = readStored(STORAGE_KEY)
  if (typeof stored !== 'object' || stored === null) {
    return { ...DEFAULTS }
  }
  const fields = stored as Record<string, unknown>
  return {
    crusherRunning: storedField(fields, 'crusherRunning', isBoolean),
    pourFlow: storedField(fields, 'pourFlow', isFlow),
    tool: storedField(fields, 'tool', isTool),
    slowMotion: storedField(fields, 'slowMotion', isBoolean),
    panelCollapsed: storedField(fields, 'panelCollapsed', isBoolean),
    autoDispatch: storedField(fields, 'autoDispatch', isBoolean),
  }
}

export function saveSettings(settings: Settings) {
  writeStored(STORAGE_KEY, settings)
}
