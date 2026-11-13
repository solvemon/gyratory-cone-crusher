import { readStored, writeStored } from './storage.ts'

const STORAGE_KEY = 'crusher-lifetime-crushed'
const SAVE_INTERVAL_MS = 2000

function loadLifetime(): number {
  const stored = readStored(STORAGE_KEY)
  if (typeof stored === 'number' && Number.isFinite(stored) && stored >= 0) {
    return stored
  }
  return 0
}

export class CrushedTally {
  session = 0
  lifetime = loadLifetime()
  private savedAt = 0

  record(sessionTotal: number, now: number) {
    const gained = sessionTotal - this.session
    if (gained > 0) {
      this.session = sessionTotal
      this.lifetime += gained
    }
    if (now - this.savedAt > SAVE_INTERVAL_MS) {
      this.save(now)
    }
  }

  startSession() {
    this.session = 0
  }

  save(now = performance.now()) {
    this.savedAt = now
    writeStored(STORAGE_KEY, this.lifetime)
  }
}
