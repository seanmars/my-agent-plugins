import { expect, test } from 'claude-code/testing'

import { fitCells, parseDecoded, rasterCells } from '../hooks/pixels'
import type { Decoded } from '../hooks/pixels'
import { imageNumbers, placeholders } from '../hooks/placeholders'

/** A picture whose top half is red and bottom half blue, in RGBA. */
function redOverBlue(width: number, height: number): Decoded {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4
      rgba.set(y < height / 2 ? [255, 0, 0, 255] : [0, 0, 255, 255], at)
    }
  }
  return { width, height, originalWidth: width, originalHeight: height, rgba }
}

/** Each cell's `[codePoint, foreground, background]`. */
function cellsOf(base64: string): number[][] {
  const words = new Uint32Array(Uint8Array.fromBase64(base64).buffer)
  const cells: number[][] = []
  for (let at = 0; at < words.length; at += 3) cells.push([...words.subarray(at, at + 3)])
  return cells
}

test('a wide picture fills the width and keeps its shape', () => {
  // 400 x 100 pixels: four times as wide as tall; a cell holds two pixels down.
  expect(fitCells(400, 100, { columns: 40, rows: 20 })).toEqual({ columns: 40, rows: 5 })
})

test('a tall picture fills the height and keeps its shape', () => {
  expect(fitCells(100, 400, { columns: 40, rows: 20 })).toEqual({ columns: 10, rows: 20 })
})

test('a size never falls below one cell', () => {
  expect(fitCells(1000, 1, { columns: 10, rows: 10 })).toEqual({ columns: 10, rows: 1 })
})

test('each cell is an upper half block: the top pixel in front, the bottom behind', () => {
  const cells = cellsOf(rasterCells(redOverBlue(4, 4), { columns: 2, rows: 2 }))

  expect(cells).toHaveLength(4)
  expect(cells[0]).toEqual([0x2580, 0xff0000, 0xff0000])
  expect(cells[2]).toEqual([0x2580, 0x0000ff, 0x0000ff])
})

test('a cell over the edge between colors shows one above the other', () => {
  const [cell] = cellsOf(rasterCells(redOverBlue(2, 2), { columns: 1, rows: 1 }))

  expect(cell).toEqual([0x2580, 0xff0000, 0x0000ff])
})

test('a transparent pixel shows the terminal default color', () => {
  const clear: Decoded = { width: 1, height: 2, originalWidth: 1, originalHeight: 2, rgba: new Uint8Array(8) }
  const [cell] = cellsOf(rasterCells(clear, { columns: 1, rows: 1 }))

  expect(cell).toEqual([0x2580, 0x01000000, 0x01000000])
})

/** A picture of `width` x `height` pixels, each the color `colorAt` gives. */
function pictureOf(width: number, height: number, colorAt: (x: number) => number): Decoded {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const color = colorAt(x)
      rgba.set([(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff, 255], (y * width + x) * 4)
    }
  }
  return { width, height, originalWidth: width, originalHeight: height, rgba }
}

test('a picture scaled down has its edges sharpened', () => {
  // 4 x 2 gray, dark left and light right, into 2 x 1 cells.
  const picture = pictureOf(4, 2, (x) => (x < 2 ? 0x646464 : 0xc8c8c8))
  const [left, right] = cellsOf(rasterCells(picture, { columns: 2, rows: 1 }))

  // Each moves half its distance from its neighbours' mean, 150, away from it.
  expect(left).toEqual([0x2580, 0x4b4b4b, 0x4b4b4b])
  expect(right).toEqual([0x2580, 0xe1e1e1, 0xe1e1e1])
})

test('a picture drawn at its own size is not sharpened', () => {
  const picture = pictureOf(2, 2, (x) => (x < 1 ? 0x646464 : 0xc8c8c8))
  const [left, right] = cellsOf(rasterCells(picture, { columns: 2, rows: 1 }))

  expect(left).toEqual([0x2580, 0x646464, 0x646464])
  expect(right).toEqual([0x2580, 0xc8c8c8, 0xc8c8c8])
})

test('the decoder output is read back as pixels', () => {
  const pixels = new Uint8Array(2 * 1 * 4).fill(7)
  const decoded = parseDecoded(`20 10 2 1\n${pixels.toBase64()}`)

  expect(decoded).toMatchObject({ width: 2, height: 1, originalWidth: 20, originalHeight: 10 })
  expect([...decoded.rgba]).toEqual([...pixels])
})

test('a decoder answer of the wrong size is refused', () => {
  expect(() => parseDecoded(`2 2 2 2\n${new Uint8Array(4).toBase64()}`)).toThrow('not an image')
})

test('placeholders are found where Claude Code wrote them', () => {
  const text = 'see [Image #1] and [Image #12], again [Image #1]'

  expect(placeholders(text)[1]).toEqual({ number: 12, start: 19, end: 30 })
  expect(imageNumbers(text)).toEqual([1, 12])
})
