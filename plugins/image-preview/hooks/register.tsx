/**
 * image-preview: every pasted image becomes a chip that opens a preview.
 *
 * Chips sit under each prompt in the transcript that carried images, and in
 * the band above the prompt for the `[Image #N]` placeholders in the draft.
 * A click opens a small card under the chip, scaled to keep the picture's
 * shape; the card's ⤢ shows the image large in a pane, which the fullscreen
 * terminal docks on the right.
 *
 * Pixels come from scripts/image.py (Pillow, run by uv), which decodes and
 * scales an image. A draft's image is the file Claude Code cached for that
 * paste, `<claude temp>/<project>/<session>/images/<n>.<ext>`. A sent
 * prompt's images come whole from `session.append`, and their paste numbers
 * from the `imagePasteIds` its transcript line keeps.
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
/** Pasting an image raises no `prompt.edit`, so the draft is read on a timer. */
const POLL_MS = 200
/** A sent prompt's transcript line is written a moment after its row: look again this often, this many times. */
const RELABEL_MS = 500
const RELABEL_TRIES = 10
/** The helper declares its own dependencies; `--no-project` keeps it clear of the session's. */
const UV = ['uv', 'run', '--quiet', '--no-project', '--script']

const MESSAGE_IMAGES = { plugin: 'image-preview', key: 'messageImages' } as const
const IMAGE_DATA = { plugin: 'image-preview', key: 'imageData' } as const
const draftImages = atom({ plugin: 'image-preview', key: 'draftImages' } as const, [])
const hint = atom({ plugin: 'image-preview', key: 'hint' } as const, null)
const expanded = atom({ plugin: 'image-preview', key: 'expanded' } as const, null)

/** Decoded pixels by image id. A reload starts it over; the next draw decodes again. */
const decoded = new Map<string, Promise<Decoded>>()
/** Ids whose decode failed: the next click on the chip tries again. */
const failed = new Set<string>()
/** The draft's image numbers as last written; unset after a reload, so the first read writes. */
let draftNumbers: string | undefined
let isReadingDraft = false
/** Where this session's paste cache and transcript are, found once per session id. */
let pasteCache: { sessionId: string; dir: string } | undefined
let transcript: { sessionId: string; path: string } | undefined

/** A drawing that holds chips; its `requestId` says which chip's card is open. */
type Site = { surface: 'terminal'; component: RenderComponent; requestId: string }
type Preview = { decoded: Decoded } | { problem: string }
type ContentBlock = Args<'session.append'>['message']['content'][number]
/** What the decoder reads: a file Claude Code cached, or bytes the transcript carried. */
type Source = { path: string } | ImageData

const draftId = (number: number) => `draft:${number}`
const draftNumber = (imageId: string) => (imageId.startsWith('draft:') ? Number(imageId.slice(6)) : undefined)
const helperPath = ($: EngineInterface) => `${$.plugin.root}/scripts/image.py`
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

// ── Claude Code's files ─────────────────────────────────────────────────────

/**
 * Where Claude Code's temp folder may be: `CLAUDE_CODE_TMPDIR`; on Windows
 * `claude` under `TEMP`; on macOS and Linux `/tmp/claude-<uid>`, found by its
 * name, since the session folder under it tells which one is this person's.
 */
async function claudeTemps($: EngineInterface): Promise<string[]> {
  const custom = await $.env.get('CLAUDE_CODE_TMPDIR')
  const temp = (await $.env.get('TEMP')) ?? (await $.env.get('TMP'))
  const posix = (await $.fs.list('/tmp').catch(() => []))
    .filter((entry) => entry.kind === 'dir' && /^claude-\d+$/.test(entry.name))
    .map((entry) => `/tmp/${entry.name}`)
  return [...(custom ? [custom] : []), ...(temp ? [`${temp}/claude`] : []), ...posix]
}

/**
 * `tail` under the one project folder of `root` that holds it. A project
 * folder is named after a working directory that may have moved since, so
 * this session's is found by what it holds instead of rebuilt.
 */
async function underProject($: EngineInterface, root: string, tail: string): Promise<string | undefined> {
  for (const entry of await $.fs.list(root).catch(() => [])) {
    const path = `${root}/${entry.name}/${tail}`
    if (entry.kind === 'dir' && (await $.fs.exists(path))) return path
  }
  return undefined
}

async function pasteCacheDir($: EngineInterface): Promise<string | undefined> {
  const sessionId = await $.session.id()
  if (pasteCache?.sessionId === sessionId) return pasteCache.dir
  for (const root of await claudeTemps($)) {
    const dir = await underProject($, root, `${sessionId}/images`)
    if (dir !== undefined) {
      pasteCache = { sessionId, dir }
      return dir
    }
  }
  return undefined
}

/** The file Claude Code cached for paste `number`, whatever its extension. */
async function pastedFile($: EngineInterface, number: number): Promise<string | undefined> {
  const dir = await pasteCacheDir($)
  if (dir === undefined) return undefined
  const name = new RegExp(`^${number}\\.[A-Za-z0-9]+$`)
  const hit = (await $.fs.list(dir).catch(() => [])).find((entry) => entry.kind === 'file' && name.test(entry.name))
  return hit === undefined ? undefined : `${dir}/${hit.name}`
}

async function transcriptPath($: EngineInterface): Promise<string | undefined> {
  const sessionId = await $.session.id()
  if (transcript?.sessionId === sessionId) return transcript.path
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  const config = (await $.env.get('CLAUDE_CONFIG_DIR')) ?? (home ? `${home}/.claude` : undefined)
  const path = config === undefined ? undefined : await underProject($, `${config}/projects`, `${sessionId}.jsonl`)
  if (path !== undefined) transcript = { sessionId, path }
  return path
}

// ── Pixels ──────────────────────────────────────────────────────────────────

async function runDecoder($: EngineInterface, source: Source): Promise<Decoded> {
  // The first run also has uv fetch Pillow, so it is given the longer wait.
  const argv = [...UV, helperPath($), 'decode', '--max', String(DECODE_MAX)]
  const result =
    'path' in source
      ? await $.process.run([...argv, '--path', source.path], { timeoutMs: 120_000 })
      : await $.process.run(argv, { stdin: source.base64, timeoutMs: 120_000 })
  if (result.exitCode !== 0) {
    const what = 'path' in source ? source.path.split('/').pop() : source.mediaType
    throw new Error(`Cannot decode ${what}: ${firstLine(result.stderr)}`)
  }
  return parseDecoded(result.stdout)
}

/** Where an image's bytes are: the paste cache for a draft's, state for a sent one's. */
async function sourceOf($: EngineInterface, imageId: string): Promise<Source> {
  const number = draftNumber(imageId)
  if (number !== undefined) {
    const path = await pastedFile($, number)
    if (path === undefined) throw new Error(`Claude Code holds no pasted image #${number} in this session.`)
    return { path }
  }
  const { value: data } = await $.state.get({ ...IMAGE_DATA, id: imageId })
  if (!data) throw new Error('This image is no longer held.')
  return data
}

async function decodeImage($: EngineInterface, imageId: string): Promise<Decoded> {
  const known = decoded.get(imageId)
  if (known) return known

  const pending = runDecoder($, await sourceOf($, imageId))
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

// ── Sent prompts ────────────────────────────────────────────────────────────

async function rememberImages($: EngineInterface, uuid: string, content: readonly ContentBlock[]): Promise<void> {
  const pictures = content.flatMap(imageData)
  if (pictures.length === 0) return

  // Until the transcript line says which pastes these are, the tags in the
  // text name them when they match the images one to one.
  const numbers = imageNumbers(content.map(textOf).join('\n'))
  const images = pictures.map((_, index) => ({
    id: `${uuid}:${index}`,
    label: numbers.length === pictures.length ? `Image #${numbers[index]}` : `Image ${index + 1}`,
  }))

  for (const [index, image] of images.entries()) {
    const picture = pictures[index]
    if (picture) await $.state.set({ ...IMAGE_DATA, id: image.id }, picture)
  }
  await $.state.set({ ...MESSAGE_IMAGES, id: uuid }, images)
  $.clock.after(RELABEL_MS, () => void relabel($, uuid, RELABEL_TRIES))
}

/** The paste numbers row `uuid`'s transcript line keeps; null until the line is written. */
async function pasteIds($: EngineInterface, uuid: string): Promise<number[] | null> {
  const path = await transcriptPath($)
  if (path === undefined) return null
  const argv = [...UV, helperPath($), 'paste-ids', '--path', path, '--uuid', uuid]
  const result = await $.process.run(argv, { timeoutMs: 120_000 })
  if (result.exitCode === 4) return []
  if (result.exitCode !== 0) return null
  return result.stdout.trim().split(',').filter(Boolean).map(Number)
}

/**
 * Names each image by the paste it came from: `imagePasteIds` keeps one
 * number per image block, in order. A typed `[Image #1]` reads the same as a
 * pasted one, so the tags in the text alone can misname them.
 */
async function relabel($: EngineInterface, uuid: string, tries: number): Promise<void> {
  try {
    const ids = await pasteIds($, uuid)
    if (ids === null) {
      if (tries > 1) $.clock.after(RELABEL_MS, () => void relabel($, uuid, tries - 1))
      return
    }
    const { value: images } = await $.state.get({ ...MESSAGE_IMAGES, id: uuid })
    if (!images || ids.length !== images.length) return
    const labeled = images.map((image, index) => ({ ...image, label: `Image #${ids[index]}` }))
    await $.state.set({ ...MESSAGE_IMAGES, id: uuid }, labeled)
  } catch (error) {
    $.ui.log(`image-preview: reading paste numbers failed: ${String(error)}`, { to: 'debug' })
  }
}

// ── The draft ───────────────────────────────────────────────────────────────

async function syncDraft($: EngineInterface, text: string): Promise<void> {
  const numbers = imageNumbers(text)
  const key = numbers.join(',')
  if (key === draftNumbers) return

  draftNumbers = key
  await update($, draftImages, () => numbers.map((number) => ({ id: draftId(number), label: `Image #${number}` })))
  // A card left open for a tag the draft no longer holds would reopen with it.
  await update($, hint, (open) => {
    const number = open === null ? undefined : draftNumber(open.imageId)
    return number !== undefined && !numbers.includes(number) ? null : open
  })
}

async function readDraft($: EngineInterface): Promise<void> {
  if (isReadingDraft) return
  isReadingDraft = true
  try {
    await syncDraft($, (await $.prompt.read()).text)
  } catch {
    // The next tick reads it again.
  } finally {
    isReadingDraft = false
  }
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
  on('session.start', async ($, e, next) => {
    $.clock.every(POLL_MS, () => void readDraft($))
    return next(e)
  })

  // Kept by the row's uuid before the row is stored, as the event allows; a
  // failure here never keeps the row from being stored.
  on('session.append', { door: 'prompt' }, async ($, e, next) => {
    if (e.agentId === undefined) await rememberImages($, e.uuid, e.message.content)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Paint only: the draft's chips come from the timer, since a paste raises no edit.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const marks = placeholders(box.text).map(({ start, end }) => ({ start, end, color: ACCENT, underline: true }))
    if (marks.length === 0) return box
    return { ...box, decorations: [...(box.decorations ?? []), ...marks] }
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
