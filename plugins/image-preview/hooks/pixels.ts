/**
 * Pixels to terminal cells. Pure: no `$`, so the tests call it directly.
 *
 * A Raster cell is one `▀`: its foreground paints the upper pixel, its
 * background the lower one. A cell is about twice as tall as it is wide, so a
 * cell holds one square pixel above another and the picture keeps its shape.
 */

/** What scripts/image.py decoded: RGBA pixels, 4 bytes each, row-major. */
export type Decoded = {
  width: number
  height: number
  originalWidth: number
  originalHeight: number
  rgba: Uint8Array
}

export type CellSize = { columns: number; rows: number }

const UPPER_HALF = 0x2580
/** Raster's "terminal default" color: what a transparent pixel shows. */
const DEFAULT_COLOR = 0x01000000

/** Reads the decode helper's output: a size line, then base64 pixels. */
export function parseDecoded(stdout: string): Decoded {
  const newline = stdout.indexOf('\n')
  const sizes = stdout.slice(0, newline).trim().split(' ').map(Number)
  const [originalWidth = 0, originalHeight = 0, width = 0, height = 0] = sizes
  const rgba = Uint8Array.fromBase64(stdout.slice(newline + 1).trim())

  if (newline < 0 || width < 1 || height < 1 || rgba.length !== width * height * 4) {
    throw new Error('the decoder answered something that is not an image')
  }
  return { width, height, originalWidth, originalHeight, rgba }
}

/** The largest box of cells inside the room that keeps the picture's shape. */
export function fitCells(width: number, height: number, room: CellSize): CellSize {
  const scale = Math.min(room.columns / width, (room.rows * 2) / height)
  return {
    columns: clamp(Math.round(width * scale), 1, room.columns),
    rows: clamp(Math.round((height * scale) / 2), 1, room.rows),
  }
}

/** Raster's `cells` for the picture scaled into `size`. */
export function rasterCells(image: Decoded, size: CellSize): string {
  const { columns, rows } = size
  const words = new Uint32Array(columns * rows * 3)

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const at = (row * columns + column) * 3
      words[at] = UPPER_HALF
      words[at + 1] = averageColor(image, column, row * 2, columns, rows * 2)
      words[at + 2] = averageColor(image, column, row * 2 + 1, columns, rows * 2)
    }
  }
  return new Uint8Array(words.buffer).toBase64()
}

/**
 * The mean color of the source pixels under target pixel (x, y) of a
 * `targetWidth` by `targetHeight` grid, weighted by alpha.
 */
function averageColor(
  image: Decoded,
  x: number,
  y: number,
  targetWidth: number,
  targetHeight: number,
): number {
  const [left, right] = span(x, targetWidth, image.width)
  const [top, bottom] = span(y, targetHeight, image.height)
  let red = 0
  let green = 0
  let blue = 0
  let alpha = 0

  for (let sy = top; sy < bottom; sy++) {
    for (let sx = left; sx < right; sx++) {
      const at = (sy * image.width + sx) * 4
      const a = image.rgba[at + 3] ?? 0
      red += (image.rgba[at] ?? 0) * a
      green += (image.rgba[at + 1] ?? 0) * a
      blue += (image.rgba[at + 2] ?? 0) * a
      alpha += a
    }
  }

  const count = (right - left) * (bottom - top)
  if (alpha < count * 128) return DEFAULT_COLOR
  return (Math.round(red / alpha) << 16) | (Math.round(green / alpha) << 8) | Math.round(blue / alpha)
}

/** The source range [start, end) that target index `i` of `target` covers. */
function span(i: number, target: number, source: number): [number, number] {
  const start = Math.min(source - 1, Math.floor((i * source) / target))
  const end = Math.max(start + 1, Math.floor(((i + 1) * source) / target))
  return [start, Math.min(end, source)]
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}
