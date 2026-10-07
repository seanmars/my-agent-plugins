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
 * prompt's images come whole from `session.append`, their paste numbers from
 * the `imagePasteIds` its transcript line keeps; once those are known, the
 * cached files stand in for the bytes.
 *
 * Everything that takes `$` is a top-level declaration: the loader inventories
 * what a hooks module reaches for through `$`.
 */
import { atom, memberOf, read, update } from 'claude-code'
import type { Args, EngineInterface, Register, RenderComponent, RenderElement, Timer } from 'claude-code'

import type { DecodeSource, ImageData, ImageRef } from '../types'
import { fitCells, parseDecoded, rasterCells } from './pixels'
import type { CellSize, Decoded } from './pixels'
import { imageNumbers, placeholders } from './placeholders'

const PANE = 'image-preview'
const ACCENT = 'suggestion'
/**
 * The card's picture at most; it shrinks to keep the shape, and to fit. Its
 * 1024 cells are no more color pairs than a Raster paints as given.
 */
const HINT_ROOM: CellSize = { columns: 64, rows: 16 }
/** A card's border, padding and indent around its picture. */
const CARD_CHROME = 6
/** The card's header needs this much even beside a narrow picture. */
const CARD_MIN_COLUMNS = 24
/** Rows the large pane asks for while it sits inline above the prompt. */
const PANE_INLINE_ROWS = 24
/** The decoder scales a picture down to fit this many pixels a side. */
const DECODE_MAX = 400
/** Decoded pictures held at most: a card and the pane draw two at a time. */
const DECODED_KEPT = 8
/** Pasting an image raises no `prompt.edit`, so the draft is read on a timer. */
const POLL_MS = 200
/** A sent prompt's transcript line is written a moment after its row: look again this often, this many times. */
const RELABEL_MS = 500
const RELABEL_TRIES = 10
/** Claude Code's temp folder under a temp root: `claude` on Windows, `claude-<uid>` elsewhere. */
const CLAUDE_TEMP = /^claude(-\d+)?$/
/** A file of the paste cache: `<paste number>.<ext>`. */
const PASTED_FILE = /^(\d+)\.[A-Za-z0-9]+$/
/**
 * The helpers declare their own dependencies, Pillow for the decoder and none
 * for the paste numbers; `--no-project` keeps them clear of the session's.
 */
const UV = ['uv', 'run', '--quiet', '--no-project', '--script']

const MESSAGE_IMAGES = { plugin: 'image-preview', key: 'messageImages' } as const
const IMAGE_SOURCE = { plugin: 'image-preview', key: 'imageSource' } as const
const draftImages = atom({ plugin: 'image-preview', key: 'draftImages' } as const, [])
const hint = atom({ plugin: 'image-preview', key: 'hint' } as const, null)
const expanded = atom({ plugin: 'image-preview', key: 'expanded' } as const, null)

/**
 * Decoded pixels by image id, the last drawn last; past DECODED_KEPT the
 * oldest goes. A reload starts it over; the next draw decodes again.
 */
const decoded = new Map<string, Promise<Decoded>>()
/** Ids whose decode failed: the next click on the chip tries again. */
const failed = new Set<string>()
/** The cells worked out for a picture, by size: a redraw at a size already drawn reuses them. */
const drawnCells = new WeakMap<Decoded, Map<string, string>>()
/** Sizes kept for one picture: the card's, as the terminal is resized. */
const SIZES_KEPT = 4
/** The draft's image numbers as last written; unset after a reload, so the first read writes. */
let draftNumbers: string | undefined
let isReadingDraft = false
/** The timer that reads the draft: one per module, whatever starts it again. */
let draftPoll: Timer | undefined
/** Where this session's paste cache and transcript are, found once per session id. */
let pasteCache: { sessionId: string; dir: string } | undefined
let transcript: { sessionId: string; path: string } | undefined

/** A drawing that holds chips; its `requestId` says which chip's card is open. */
type Site = { surface: 'terminal'; component: RenderComponent; requestId: string }
type Preview = { decoded: Decoded } | { problem: string }
type ContentBlock = Args<'session.append'>['message']['content'][number]

const draftId = (number: number) => `draft:${number}`
const draftNumber = (imageId: string) => (imageId.startsWith('draft:') ? Number(imageId.slice(6)) : undefined)
const helperPath = ($: EngineInterface, script: string) => `${$.plugin.root}/scripts/${script}`
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
 * Where Claude Code's temp folder may be: `claude` on Windows, `claude-<uid>`
 * on macOS and Linux, under `CLAUDE_CODE_TMPDIR` when it is set, else under
 * the system's temp folder. Each is found by its name, since the session
 * folder under it tells which one is this person's.
 */
async function claudeTemps($: EngineInterface): Promise<string[]> {
  const custom = await $.env.get('CLAUDE_CODE_TMPDIR')
  const system = [await $.env.get('TEMP'), await $.env.get('TMP'), await $.env.get('TMPDIR'), '/tmp']
  const bases = (custom ? [custom] : system).flatMap((base) => (base ? [base.replace(/[\\/]+$/, '')] : []))

  const temps: string[] = []
  for (const base of new Set(bases)) {
    for (const entry of await $.fs.list(base).catch(() => [])) {
      if (entry.kind === 'dir' && CLAUDE_TEMP.test(entry.name)) temps.push(`${base}/${entry.name}`)
    }
  }
  return temps
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

/** The files Claude Code cached for this session's pastes, by paste number, whatever their extension. */
async function pastedFiles($: EngineInterface): Promise<Map<number, string>> {
  const files = new Map<number, string>()
  const dir = await pasteCacheDir($)
  if (dir === undefined) return files
  for (const entry of await $.fs.list(dir).catch(() => [])) {
    const paste = entry.kind === 'file' ? PASTED_FILE.exec(entry.name) : null
    if (paste) files.set(Number(paste[1]), `${dir}/${entry.name}`)
  }
  return files
}

/** The transcript a classic event names: each prompt, and each session that starts. */
function noteTranscript(e: { session_id: string; transcript_path: string }): void {
  if (e.transcript_path) transcript = { sessionId: e.session_id, path: e.transcript_path }
}

/**
 * The session's transcript, as a classic event named it; after a reload,
 * until the next prompt names it, found by its name under the config folder.
 */
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

async function runDecoder($: EngineInterface, source: DecodeSource): Promise<Decoded> {
  // The first run also has uv fetch Pillow, so it is given the longer wait.
  const argv = [...UV, helperPath($, 'image.py'), 'decode', '--max', String(DECODE_MAX)]
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
async function sourceOf($: EngineInterface, imageId: string): Promise<DecodeSource> {
  const number = draftNumber(imageId)
  if (number !== undefined) {
    const path = (await pastedFiles($)).get(number)
    if (path === undefined) throw new Error(`Claude Code holds no pasted image #${number} in this session.`)
    return { path }
  }
  const { value: source } = await $.state.get({ ...IMAGE_SOURCE, id: imageId })
  if (!source) throw new Error('This image is no longer held.')
  return source
}

function forgetDecoded(imageId: string): void {
  decoded.delete(imageId)
  failed.delete(imageId)
}

/**
 * The image's pixels, decoded once. The promise is kept before anything is
 * awaited, so a second drawing of the same image waits on the first decode.
 */
function decodeImage($: EngineInterface, imageId: string): Promise<Decoded> {
  const known = decoded.get(imageId)
  const pending = known ?? sourceOf($, imageId).then((source) => runDecoder($, source))
  decoded.delete(imageId)
  decoded.set(imageId, pending)
  if (!known) pending.catch(() => failed.add(imageId))

  for (const oldest of decoded.keys()) {
    if (decoded.size <= DECODED_KEPT) break
    forgetDecoded(oldest)
  }
  return pending
}

/**
 * A draft's `[Image #N]` names a paste of the session it is in: once another
 * session starts, the pixels decoded for it are another session's picture.
 */
function forgetDrafts(): void {
  for (const imageId of decoded.keys()) {
    if (draftNumber(imageId) !== undefined) forgetDecoded(imageId)
  }
  // Unset, so the next tick writes the chips for the new session.
  draftNumbers = undefined
}

/** Raster cells for the picture at `size`, worked out once per size. */
function cellsFor(picture: Decoded, size: CellSize): string {
  const key = `${size.columns}x${size.rows}`
  const sizes = drawnCells.get(picture) ?? new Map<string, string>()
  drawnCells.set(picture, sizes)

  const cells = sizes.get(key) ?? rasterCells(picture, size)
  sizes.delete(key)
  sizes.set(key, cells)
  for (const oldest of sizes.keys()) {
    if (sizes.size <= SIZES_KEPT) break
    sizes.delete(oldest)
  }
  return cells
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

  // Held until the transcript line names the pastes; `keepPastes` lets them go.
  for (const [index, image] of images.entries()) {
    const picture = pictures[index]
    if (picture) await $.state.set({ ...IMAGE_SOURCE, id: image.id }, picture)
  }
  await $.state.set({ ...MESSAGE_IMAGES, id: uuid }, images)
  $.clock.after(RELABEL_MS, () => void relabel($, uuid, RELABEL_TRIES))
}

/** The paste numbers row `uuid`'s transcript line keeps; null until the line is written. */
async function pasteIds($: EngineInterface, uuid: string): Promise<number[] | null> {
  const path = await transcriptPath($)
  if (path === undefined) return null
  const argv = [...UV, helperPath($, 'paste_ids.py'), '--path', path, '--uuid', uuid]
  const result = await $.process.run(argv, { timeoutMs: 30_000 })
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
    await keepPastes($, images, ids)
    await relabelPane($, labeled)
  } catch (error) {
    $.ui.log(`image-preview: reading paste numbers failed: ${String(error)}`, { to: 'debug' })
  }
}

/**
 * Swaps each image's bytes for the file Claude Code cached for its paste: the
 * session then holds a path, not megabytes. Bytes with no file stay.
 */
async function keepPastes($: EngineInterface, images: ImageRef[], ids: number[]): Promise<void> {
  const files = await pastedFiles($)
  for (const [index, image] of images.entries()) {
    const path = files.get(ids[index] ?? -1)
    if (path !== undefined) await $.state.set({ ...IMAGE_SOURCE, id: image.id }, { path })
  }
}

/** The pane keeps a copy of its image: it takes the new label, and the open pane its title. */
async function relabelPane($: EngineInterface, labeled: ImageRef[]): Promise<void> {
  const shown = await read($, expanded)
  const fresh = labeled.find((image) => image.id === shown?.id)
  if (!fresh || fresh.label === shown?.label) return

  await update($, expanded, (image) => (image?.id === fresh.id ? fresh : image))
  const panes = await $.ui.panes()
  if (panes.some((pane) => pane.id === PANE)) await $.ui.open({ id: PANE, title: fresh.label, rows: PANE_INLINE_ROWS })
}

// ── The draft ───────────────────────────────────────────────────────────────

async function syncDraft($: EngineInterface, text: string): Promise<void> {
  const numbers = imageNumbers(text)
  const key = numbers.join(',')
  if (key === draftNumbers) return

  await update($, draftImages, () => numbers.map((number) => ({ id: draftId(number), label: `Image #${number}` })))
  // A card left open for a tag the draft no longer holds would reopen with it.
  await update($, hint, (open) => {
    const number = open === null ? undefined : draftNumber(open.imageId)
    return number !== undefined && !numbers.includes(number) ? null : open
  })
  // Kept once both writes landed: after a failed one the next tick writes again.
  draftNumbers = key
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
          <Raster key={`hint:${image.id}`} columns={size.columns} rows={size.rows} cells={cellsFor(preview.decoded, size)} />
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
    // A draft is a person's at the terminal prompt, and the band is drawn there alone.
    if (e.isInteractive && e.surface === 'terminal') draftPoll ??= $.clock.every(POLL_MS, () => void readDraft($))
    return next(e)
  })

  // `/clear`, `/resume` and a fork switch sessions without another `session.start`.
  on('classic.SessionStart', async ($, e, next) => {
    forgetDrafts()
    noteTranscript(e)
    return next(e)
  }).catch(($, e, next) => next(e))

  // Raised before the prompt's row is appended, so its relabel knows the transcript.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    noteTranscript(e)
    return next(e)
  }).catch(($, e, next) => next(e))

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
