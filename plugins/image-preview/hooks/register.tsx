/**
 * image-preview: every pasted image becomes a chip that opens a preview.
 *
 * Chips sit under each prompt in the transcript that carried images, and in
 * the band above the prompt for the `[Image #N]` placeholders in the draft.
 * A click opens a small card under the chip, scaled to keep the picture's
 * shape; the card's ⤢ shows the image large in a pane, which the fullscreen
 * terminal docks on the right.
 *
 * Pixels come from scripts/image.ps1 (Windows PowerShell), which decodes and
 * scales an image. The engine hands plugins no bytes of a draft's images, so
 * a new placeholder in the draft reads the clipboard once, right after the
 * paste; a sent prompt's images come whole from `session.append`.
 *
 * Everything that takes `$` is a top-level declaration: the loader inventories
 * what a hooks module reaches for through `$`.
 */
import { atom, memberOf, read, update } from 'claude-code'
import type { Args, EngineInterface, Register, RenderComponent, RenderElement } from 'claude-code'

import type { ImageData, ImageRef } from '../types'
import { fitCells, parseDecoded, rasterCells } from './pixels'
import type { CellSize, Decoded } from './pixels'
import { imageNumbers, placeholders } from './placeholders'

const PANE = 'image-preview'
const ACCENT = 'suggestion'
/** The card's picture at most; it shrinks to keep the shape, and to fit. */
const HINT_ROOM: CellSize = { columns: 48, rows: 12 }
/** A card's border, padding and indent around its picture. */
const CARD_CHROME = 6
/** The card's header needs this much even beside a narrow picture. */
const CARD_MIN_COLUMNS = 24
/** Rows the large pane asks for while it sits inline above the prompt. */
const PANE_INLINE_ROWS = 24
/** The decoder scales a picture down to fit this many pixels a side. */
const DECODE_MAX = 400
const POWERSHELL = ['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File']
const NO_DRAFT_PIXELS = 'No pixels yet: the clipboard had no image to read. Send the prompt to preview it.'

const MESSAGE_IMAGES = { plugin: 'image-preview', key: 'messageImages' } as const
const IMAGE_DATA = { plugin: 'image-preview', key: 'imageData' } as const
const draftImages = atom({ plugin: 'image-preview', key: 'draftImages' } as const, [])
const hint = atom({ plugin: 'image-preview', key: 'hint' } as const, null)
const expanded = atom({ plugin: 'image-preview', key: 'expanded' } as const, null)

/** Decoded pixels by image id. A reload starts it over; the next draw decodes again. */
const decoded = new Map<string, Promise<Decoded>>()
/** Ids whose decode failed: the next click on the chip tries again. */
const failed = new Set<string>()
/** Draft image numbers already read off the clipboard, so each is read once. */
const captured = new Set<number>()
/** The draft's image numbers as last written, so an edit that keeps them writes nothing. */
let draftNumbers = ''

/** A drawing that holds chips; its `requestId` says which chip's card is open. */
type Site = { surface: 'terminal'; component: RenderComponent; requestId: string }
type Preview = { decoded: Decoded } | { problem: string }
type ContentBlock = Args<'session.append'>['message']['content'][number]

const draftId = (number: number) => `draft:${number}`
const helperPath = ($: EngineInterface) => `${$.plugin.root}/scripts/image.ps1`
const firstLine = (text: string) => text.trim().split(/\r?\n/)[0] ?? ''

function cardRoom(columns: number, rows: number): CellSize {
  return {
    columns: Math.max(1, Math.min(HINT_ROOM.columns, columns - CARD_CHROME)),
    rows: Math.max(1, Math.min(HINT_ROOM.rows, rows)),
  }
}

function caption(image: ImageRef, preview: Preview): string {
  if (!('decoded' in preview)) return image.label
  return `${image.label} · ${preview.decoded.originalWidth}×${preview.decoded.originalHeight}`
}

/** An image block's bytes, when the block is one the engine holds inline. */
function imageData(block: ContentBlock): ImageData[] {
  const source = block.source as { type?: unknown; media_type?: unknown; data?: unknown } | undefined
  if (block.type !== 'image' || source?.type !== 'base64' || typeof source.data !== 'string') return []
  const mediaType = typeof source.media_type === 'string' ? source.media_type : 'image'
  return [{ mediaType, base64: source.data }]
}

function textOf(block: ContentBlock): string {
  return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
}

// ── Pixels ──────────────────────────────────────────────────────────────────

async function runDecoder($: EngineInterface, data: ImageData): Promise<Decoded> {
  const argv = [...POWERSHELL, helperPath($), '-Mode', 'decode', '-Max', String(DECODE_MAX)]
  const result = await $.process.run(argv, { stdin: data.base64, timeoutMs: 20_000 })
  if (result.exitCode !== 0) {
    throw new Error(`Cannot decode this ${data.mediaType}: ${firstLine(result.stderr)}`)
  }
  return parseDecoded(result.stdout)
}

async function decodeImage($: EngineInterface, imageId: string): Promise<Decoded> {
  const known = decoded.get(imageId)
  if (known) return known

  const { value: data } = await $.state.get({ ...IMAGE_DATA, id: imageId })
  if (!data) {
    throw new Error(imageId.startsWith('draft:') ? NO_DRAFT_PIXELS : 'This image is no longer held.')
  }

  const pending = runDecoder($, data)
  decoded.set(imageId, pending)
  pending.catch(() => failed.add(imageId))
  return pending
}

async function loadPreview($: EngineInterface, imageId: string): Promise<Preview> {
  try {
    return { decoded: await decodeImage($, imageId) }
  } catch (error) {
    return { problem: error instanceof Error ? error.message : String(error) }
  }
}

// ── What the session hands over ─────────────────────────────────────────────

async function rememberImages($: EngineInterface, uuid: string, content: readonly ContentBlock[]): Promise<void> {
  const pictures = content.flatMap(imageData)
  if (pictures.length === 0) return

  // Claude Code keeps `[Image #N]` in the prompt's text, one per image.
  const numbers = imageNumbers(content.map(textOf).join('\n'))
  const images = pictures.map((_, index) => ({
    id: `${uuid}:${index}`,
    label: `Image #${numbers.length === pictures.length ? numbers[index] : index + 1}`,
  }))

  for (const [index, image] of images.entries()) {
    await $.state.set({ ...IMAGE_DATA, id: image.id }, pictures[index] ?? null)
  }
  await $.state.set({ ...MESSAGE_IMAGES, id: uuid }, images)
}

async function readClipboard($: EngineInterface, number: number): Promise<void> {
  try {
    const argv = [...POWERSHELL, helperPath($), '-Mode', 'clipboard']
    const result = await $.process.run(argv, { timeoutMs: 10_000 })
    if (result.exitCode !== 0) return
    await $.state.set({ ...IMAGE_DATA, id: draftId(number) }, { mediaType: 'image/png', base64: result.stdout.trim() })
  } catch (error) {
    $.ui.log(`image-preview: reading the clipboard failed: ${String(error)}`, { to: 'debug' })
  }
}

async function syncDraft($: EngineInterface, text: string): Promise<void> {
  const numbers = imageNumbers(text)
  const key = numbers.join(',')
  if (key === draftNumbers) return

  draftNumbers = key
  await update($, draftImages, () => numbers.map((number) => ({ id: draftId(number), label: `Image #${number}` })))

  for (const number of numbers) {
    if (captured.has(number)) continue
    captured.add(number)
    $.clock.after(0, () => void readClipboard($, number))
  }
}

async function clearDraft($: EngineInterface): Promise<void> {
  for (const number of captured) {
    decoded.delete(draftId(number))
    failed.delete(draftId(number))
    await $.state.set({ ...IMAGE_DATA, id: draftId(number) }, null)
  }
  captured.clear()
  draftNumbers = ''
  await update($, draftImages, () => [])
  await update($, hint, (open) => (open?.imageId.startsWith('draft:') ? null : open))
}

// ── Presses ─────────────────────────────────────────────────────────────────

async function toggleHint($: EngineInterface, site: string, imageId: string): Promise<void> {
  if (failed.delete(imageId)) decoded.delete(imageId)
  await update($, hint, (open) => (open?.site === site && open.imageId === imageId ? null : { site, imageId }))
}

async function closeHint($: EngineInterface): Promise<void> {
  await update($, hint, () => null)
}

async function expand($: EngineInterface, image: ImageRef): Promise<void> {
  await update($, expanded, () => image)
  await $.ui.open({ id: PANE, title: image.label, rows: PANE_INLINE_ROWS })
}

// ── Drawing ─────────────────────────────────────────────────────────────────

async function hintCard($: EngineInterface, site: Site, image: ImageRef, room: CellSize): Promise<RenderElement> {
  const { Box, Text, Button, Raster } = $.ui.resolve(site)
  const preview = await loadPreview($, image.id)
  const size = 'decoded' in preview ? fitCells(preview.decoded.width, preview.decoded.height, room) : room
  const inner = Math.max(size.columns, CARD_MIN_COLUMNS)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={ACCENT} paddingX={1} width={inner + 4} marginLeft={2}>
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold wrap="truncate-end">{caption(image, preview)}</Text>
        <Box flexDirection="row" gap={1}>
          <Button key={`expand:${image.id}`} label="⤢" plain onPress={() => expand($, image)} />
          <Button key={`close:${image.id}`} label="✕" plain onPress={() => closeHint($)} />
        </Box>
      </Box>
      {'decoded' in preview ? (
        <Box justifyContent="center">
          <Raster key={`hint:${image.id}`} columns={size.columns} rows={size.rows} cells={rasterCells(preview.decoded, size)} />
        </Box>
      ) : (
        <Text dimColor wrap="wrap">{preview.problem}</Text>
      )}
    </Box>
  )
}

async function chipStrip($: EngineInterface, site: Site, images: ImageRef[], lead: string, room: CellSize): Promise<RenderElement> {
  const { Box, Text, Button } = $.ui.resolve(site)
  const open = await read($, hint)
  const shown = open?.site === site.requestId ? images.find((image) => image.id === open.imageId) : undefined
  const card = shown ? await hintCard($, site, shown, room) : null

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{lead}</Text>
        {images.map((image) => (
          <Button
            key={`chip:${image.id}`}
            label={image.label}
            variant={image === shown ? 'primary' : undefined}
            onPress={() => toggleHint($, site.requestId, image.id)}
          />
        ))}
      </Box>
      {card}
    </Box>
  )
}

export const register: Register = (on) => {
  // Kept by the row's uuid before the row is stored, as the event allows; a
  // failure here never keeps the row from being stored.
  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    if (e.agentId === undefined) await rememberImages($, e.uuid, e.message.content)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    await syncDraft($, box.text)

    const marks = placeholders(box.text).map(({ start, end }) => ({ start, end, color: ACCENT, underline: true }))
    if (marks.length === 0) return box
    return { ...box, decorations: [...(box.decorations ?? []), ...marks] }
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    await clearDraft($)
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'UserMessage', surface: 'terminal' }, async ($, e, next) => {
    const images = await read($, memberOf(MESSAGE_IMAGES, e))
    if (!images?.length) return next(e)

    const { Box } = $.ui.resolve(e)
    const drawn = await next(e)
    const strip = await chipStrip($, e, images, '⎿', cardRoom((e.viewport?.columns ?? 80) - 2, HINT_ROOM.rows))
    return (
      <Box flexDirection="column">
        {drawn}
        <Box marginLeft={2}>{strip}</Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AbovePrompt', surface: 'terminal' }, async ($, e, next) => {
    const images = await read($, draftImages)
    if (e.props.hasSurvey || images.length === 0) return next(e)

    const { Box } = $.ui.resolve(e)
    const below = await next(e)
    // The chip row, the card's border and its header take four of the rows.
    const strip = await chipStrip($, e, images, 'Pasted', cardRoom(e.props.bodyColumns, e.props.maxRows - 4))
    return (
      <Box flexDirection="column">
        {below}
        {strip}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE, surface: 'terminal' }, async ($, e) => {
    const { Box, Text, Raster } = $.ui.resolve(e)
    const image = await read($, expanded)
    if (!image) return <Text dimColor>Click an image chip, then ⤢ on its card.</Text>

    const preview = await loadPreview($, image.id)
    if (!('decoded' in preview)) return <Text dimColor wrap="wrap">{preview.problem}</Text>

    // One row goes to the caption.
    const room = { columns: Math.max(1, e.props.bodyColumns), rows: Math.max(1, e.props.scroll.bodyRows - 1) }
    const size = fitCells(preview.decoded.width, preview.decoded.height, room)
    return (
      <Box flexDirection="column" alignItems="center">
        <Text dimColor wrap="truncate-end">{caption(image, preview)}</Text>
        <Raster key="large" columns={size.columns} rows={size.rows} cells={rasterCells(preview.decoded, size)} />
      </Box>
    )
  })
}
