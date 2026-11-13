const WINDOW_SECONDS = 0.5
const MAX_MANTLE_CATCH_UP = 3

export class Pacing {
  catchUp = 1
  private realTime = 0
  private simulatedTime = 0

  record(elapsed: number, simulated: number) {
    const keep = Math.exp(-elapsed / WINDOW_SECONDS)
    this.realTime = this.realTime * keep + elapsed
    this.simulatedTime = this.simulatedTime * keep + simulated
    if (this.simulatedTime <= 0) {
      this.catchUp = MAX_MANTLE_CATCH_UP
      return
    }
    this.catchUp = Math.min(MAX_MANTLE_CATCH_UP, Math.max(1, this.realTime / this.simulatedTime))
  }
}

export class Average {
  value = 0

  add(sample: number) {
    this.value = this.value * 0.9 + sample * 0.1
  }
}
