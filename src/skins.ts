export type Skin = {
  source: HTMLCanvasElement
  base: string
  width: number
  height: number
}

const SLAB_LONG_SIDE = 3
const MOST_ELONGATED = 2.5
const LARGEST_IMAGE_PIXELS = 512
const SHEET_WIDTH = 362
const SHEET_HEIGHT = 512
const SHEET_MARGIN = 34
const PAPER = '#ece5d6'
const INK = '#1c1a17'
const STAMP_RED = 'rgba(178, 34, 28, 0.82)'
const FONT_STACK = "'Arial Narrow', 'Roboto Condensed', 'Helvetica Neue', Arial, sans-serif"

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Canvas 2D is not available')
  }
  return [canvas, context]
}

function slabSize(pixelWidth: number, pixelHeight: number): { width: number; height: number } {
  const ratio = Math.min(MOST_ELONGATED, Math.max(1 / MOST_ELONGATED, pixelWidth / pixelHeight))
  if (ratio >= 1) {
    return { width: SLAB_LONG_SIDE, height: SLAB_LONG_SIDE / ratio }
  }
  return { width: SLAB_LONG_SIDE * ratio, height: SLAB_LONG_SIDE }
}

export function skinFromImage(image: ImageBitmap): Skin {
  const shrink = Math.min(1, LARGEST_IMAGE_PIXELS / Math.max(image.width, image.height))
  const size = slabSize(image.width, image.height)
  const pixelWidth = Math.max(1, Math.round(image.width * shrink))
  const pixelHeight = Math.max(1, Math.round((pixelWidth * size.height) / size.width))
  const [canvas, context] = canvasOf(pixelWidth, pixelHeight)
  const cover = Math.max(pixelWidth / image.width, pixelHeight / image.height)
  const drawnWidth = image.width * cover
  const drawnHeight = image.height * cover
  context.drawImage(image, (pixelWidth - drawnWidth) / 2, (pixelHeight - drawnHeight) / 2, drawnWidth, drawnHeight)
  return { source: canvas, base: '#6f6a64', ...size }
}

function speckle(context: CanvasRenderingContext2D, width: number, height: number) {
  for (let i = 0; i < 900; i++) {
    const shade = Math.random() < 0.5 ? 0 : 255
    context.fillStyle = `rgba(${shade}, ${shade}, ${shade}, ${Math.random() * 0.05})`
    context.fillRect(Math.random() * width, Math.random() * height, 1 + Math.random() * 2, 1 + Math.random() * 2)
  }
}

function wrapWords(context: CanvasRenderingContext2D, words: string[], maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line)
      line = word
      continue
    }
    line = candidate
  }
  if (line) {
    lines.push(line)
  }
  return lines
}

function fitText(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxHeight: number) {
  const words = text.toUpperCase().split(/\s+/).filter(Boolean)
  for (let size = 120; size > 14; size -= 4) {
    context.font = `700 ${size}px ${FONT_STACK}`
    const lines = wrapWords(context, words, maxWidth)
    const widest = Math.max(...lines.map((line) => context.measureText(line).width))
    const lineHeight = size * 1.02
    if (widest <= maxWidth && lines.length * lineHeight <= maxHeight) {
      return { lines, size, lineHeight }
    }
  }
  context.font = `700 14px ${FONT_STACK}`
  return { lines: wrapWords(context, words, maxWidth), size: 14, lineHeight: 15 }
}

function stamp(context: CanvasRenderingContext2D) {
  context.save()
  context.translate(SHEET_WIDTH * 0.62, SHEET_HEIGHT - 70)
  context.rotate(-0.22)
  context.strokeStyle = STAMP_RED
  context.fillStyle = STAMP_RED
  context.lineWidth = 4
  context.strokeRect(-92, -24, 184, 48)
  context.font = `700 26px ${FONT_STACK}`
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText('TO BE CRUSHED', 0, 2)
  context.restore()
}

export function problemSheet(problem: string): Skin {
  const [canvas, context] = canvasOf(SHEET_WIDTH, SHEET_HEIGHT)
  context.fillStyle = PAPER
  context.fillRect(0, 0, SHEET_WIDTH, SHEET_HEIGHT)
  speckle(context, SHEET_WIDTH, SHEET_HEIGHT)
  context.fillStyle = 'rgba(28, 26, 23, 0.55)'
  context.font = `700 20px ${FONT_STACK}`
  context.textBaseline = 'alphabetic'
  context.fillText('PROBLEM', SHEET_MARGIN, SHEET_MARGIN + 18)
  context.fillRect(SHEET_MARGIN, SHEET_MARGIN + 28, SHEET_WIDTH - SHEET_MARGIN * 2, 2)
  const area = { top: SHEET_MARGIN + 50, height: SHEET_HEIGHT - SHEET_MARGIN * 2 - 150 }
  const fitted = fitText(context, problem, SHEET_WIDTH - SHEET_MARGIN * 2, area.height)
  const blockHeight = fitted.lines.length * fitted.lineHeight
  context.fillStyle = INK
  context.textBaseline = 'top'
  fitted.lines.forEach((line, index) => {
    const y = area.top + (area.height - blockHeight) / 2 + index * fitted.lineHeight
    context.fillText(line, SHEET_MARGIN, y)
  })
  stamp(context)
  return { source: canvas, base: PAPER, ...slabSize(SHEET_WIDTH, SHEET_HEIGHT) }
}
