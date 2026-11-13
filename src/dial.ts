type DialOptions = {
  min: number
  max: number
  step: number
  value: number
  onChange: (value: number) => void
}

const SWEEP_DEGREES = 270
const DRAG_PIXELS_FOR_FULL_RANGE = 160
const TICKS = 10

function findKnob(element: HTMLElement): HTMLElement {
  const knob = element.querySelector<HTMLElement>('.dial-knob')
  if (!knob) {
    throw new Error('Dial is missing its knob')
  }
  return knob
}

export function mountDial(element: HTMLElement, options: DialOptions) {
  const { min, max, step, onChange } = options
  const knob = findKnob(element)
  for (let i = 0; i < TICKS; i++) {
    const tick = document.createElement('span')
    tick.className = 'dial-tick'
    tick.style.setProperty('--angle', `${-SWEEP_DEGREES / 2 + (SWEEP_DEGREES * i) / (TICKS - 1)}deg`)
    element.prepend(tick)
  }

  let value = options.value
  let dragStart: { y: number; value: number } | null = null

  function render() {
    const fraction = (value - min) / (max - min)
    knob.style.setProperty('--angle', `${-SWEEP_DEGREES / 2 + SWEEP_DEGREES * fraction}deg`)
    element.setAttribute('aria-valuenow', String(value))
  }

  function set(next: number) {
    const snapped = Math.round(Math.min(max, Math.max(min, next)) / step) * step
    if (snapped === value) {
      return
    }
    value = snapped
    render()
    onChange(value)
  }

  element.setAttribute('aria-valuemin', String(min))
  element.setAttribute('aria-valuemax', String(max))
  element.addEventListener('pointerdown', (event) => {
    element.setPointerCapture(event.pointerId)
    dragStart = { y: event.clientY, value }
  })
  element.addEventListener('pointermove', (event) => {
    if (dragStart) {
      set(dragStart.value + ((dragStart.y - event.clientY) * (max - min)) / DRAG_PIXELS_FOR_FULL_RANGE)
    }
  })
  for (const type of ['pointerup', 'pointercancel'] as const) {
    element.addEventListener(type, () => {
      dragStart = null
    })
  }
  element.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      set(value - Math.sign(event.deltaY) * step)
    },
    { passive: false },
  )
  element.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault()
      set(value + step)
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault()
      set(value - step)
    }
  })
  render()
}
