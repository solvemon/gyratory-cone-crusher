import { readStored, writeStored } from './storage.ts'

export const PRESET_PROBLEMS = [
  'Self doubt',
  'Insecure',
  'Broke',
  'Overweight',
  'Stress',
  'Procrastination',
  'Mondays',
  'Imposter syndrome',
]

const STORAGE_KEY = 'crusher-own-problems'
const MOST_OWN_PROBLEMS = 12

function sameProblem(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase()
}

export function loadOwnProblems(): string[] {
  const stored = readStored(STORAGE_KEY)
  if (!Array.isArray(stored)) {
    return []
  }
  return stored.filter((item): item is string => typeof item === 'string').slice(0, MOST_OWN_PROBLEMS)
}

export function rememberProblem(own: string[], problem: string): string[] {
  const isPreset = PRESET_PROBLEMS.some((preset) => sameProblem(preset, problem))
  if (isPreset) {
    return own
  }
  const others = own.filter((item) => !sameProblem(item, problem))
  const updated = [problem, ...others].slice(0, MOST_OWN_PROBLEMS)
  writeStored(STORAGE_KEY, updated)
  return updated
}

export function forgetProblem(own: string[], problem: string): string[] {
  const updated = own.filter((item) => item !== problem)
  writeStored(STORAGE_KEY, updated)
  return updated
}
