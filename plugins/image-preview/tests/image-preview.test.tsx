import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Args, FsEntry, On, ProcessRunResult, RenderPropsOf, SessionStartInput } from 'claude-code'

const PLUGIN = 'image-preview'
const UUID = 'message-1'
const PNG = 'iVBORw0KGgo='
const SESSION: SessionStartInput = { cwd: 'C:/work', surface: 'terminal', isInteractive: true }

/** What the decoder answers for any picture: 8 x 4 pixels of red, scaled to 4 x 2. */
const DECODED = `8 4 4 2\n${new Uint8Array(4 * 2 * 4).map((_, i) => (i % 4 === 1 || i % 4 === 2 ? 0 : 255)).toBase64()}`

/**
 * Claude Code's folders, the paste cache and the transcripts: Windows keeps
 * its temp folder under TEMP, macOS under /tmp/claude-<uid>.
 */
const PASTES = 'C:/Temp/claude/C--work/session-1/images'
const MAC_PASTES = '/tmp/claude-501/-Users-me-work/session-1/images'
const TRANSCRIPT = 'C:/Users/me/.claude/projects/C--work/session-1.jsonl'
const entry = (name: string, kind: FsEntry['kind']): FsEntry => ({ name, kind, size: 1, mtimeMs: 0, isLink: false })
/**
 * The engine hands an fs hook the host's spelling of a path (`C:\Temp`, and
 * `/tmp` as `C:\tmp` on Windows), so paths are compared without drive or
 * separator style, and the same test runs on either machine.
 */
const fsKey = (path: string) => path.replace(/\\/g, '/').replace(/^[A-Za-z]:/, '')
const FOLDERS = new Map(
  Object.entries({
    'C:/Temp/claude': [entry('C--elsewhere', 'dir'), entry('C--work', 'dir')],
    [PASTES]: [entry('2.png', 'file'), entry('20.jpg', 'file')],
    '/tmp': [entry('claude-0', 'dir'), entry('claude-501', 'dir'), entry('claude-notes', 'dir')],
    '/tmp/claude-501': [entry('-Users-me-work', 'dir')],
    [MAC_PASTES]: [entry('2.png', 'file')],
    'C:/Users/me/.claude/projects': [entry('C--work', 'dir')],
  }).map(([path, entries]) => [fsKey(path), entries]),
)
const PRESENT = new Set([PASTES, MAC_PASTES, TRANSCRIPT].map(fsKey))
const WINDOWS_ENV = { TEMP: 'C:/Temp', USERPROFILE: 'C:/Users/me' }

const BAND_PROPS: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

const PANE_PROPS: RenderPropsOf['Pane'] = {
  title: 'Image #1',
  isFocused: false,
  bodyColumns: 60,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
}

const userMessage = (text: string): RenderPropsOf['UserMessage'] => ({
  text,
  origin: { kind: 'composer' },
  isExpanded: false,
})

const promptRow = (uuid: string, content: Args<'session.append'>['message']['content']): Args<'session.append'> => ({
  message: { type: 'user', role: 'user', content },
  door: 'prompt',
  origin: { kind: 'composer' },
  uuid,
})

type Answer = Pick<ProcessRunResult, 'exitCode' | 'stdout' | 'stderr'>
type Host = {
  /** What the decoder answers. */
  decoder?: Answer
  /** What each look for paste numbers answers in turn; the last repeats. */
  pasteIds?: Answer[]
  /** The environment the plugin reads; Windows' when not given. */
  env?: Record<string, string>
}

/**
 * A test's `on` is the bottom of the chain: the engine's own behaviour, the
 * prompt box, Claude Code's files and the uv helper are answered here.
 */
const setup = (on: On, host: Host = {}) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, host.env ?? WINDOWS_ENV)
  const draft = { text: '' }
  const runs: Args<'process.run'>[] = []
  const opened: Args<'ui.open'>[] = []
  const pasteIds = [...(host.pasteIds ?? [{ exitCode: 3, stdout: '', stderr: '' }])]

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'session-1' }))
  on('prompt.read', () => ({ value: { text: draft.text, cursor: draft.text.length } }))
  on('fs.list', ($, e) => ({ value: FOLDERS.get(fsKey(e.path)) ?? [] }))
  on('fs.exists', ($, e) => ({ value: PRESENT.has(fsKey(e.path)) }))
  on('process.run', ($, e) => {
    runs.push(e)
    const answer =
      e.argv.includes('paste-ids')
        ? (pasteIds.length > 1 ? pasteIds.shift() : pasteIds[0])
        : (host.decoder ?? { exitCode: 0, stdout: DECODED, stderr: '' })
    return { value: { exitCode: 1, stdout: '', stderr: '', ...answer, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{'engine'}</Text>
  })
  return { clock, draft, runs, opened }
}

const runsOf = (runs: Args<'process.run'>[], mode: string) => runs.filter((run) => run.argv.includes(mode))

/**
 * Appends a prompt row. The kit has no store beneath the chain for rows (a
 * test's own hook may not answer one without `next`), so the append rejects
 * once the plugin has seen the row; what the plugin kept is what is tested.
 */
const append = ($: Engine, row: Args<'session.append'>) => $.session.append(row).catch(() => undefined)

const sendImage = ($: Engine, text = '[Image #1] what is this?') =>
  append(
    $,
    promptRow(UUID, [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
      { type: 'text', text },
    ]),
  )

const mountMessage = ($: Engine, requestId = UUID) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', props: userMessage('[Image #1] what is this?'), requestId, viewport: { columns: 100, rows: 40 } })

const mountBand = ($: Engine, props: Partial<RenderPropsOf['AbovePrompt']> = {}) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...BAND_PROPS, ...props } })

// ── Sent prompts ────────────────────────────────────────────────────────────

test('a sent image becomes a chip under its prompt', async ($, on) => {
  setup(on)
  await sendImage($)

  const ui = await mountMessage($)
  expect(await ui.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect((await ui.find({ key: `chip:${UUID}:0` }))?.props.label).toBe('Image #1')
})

test('a prompt with no image is left to the engine', async ($, on) => {
  setup(on)
  await append($, promptRow('plain', [{ type: 'text', text: 'hello' }]))

  const ui = await mountMessage($, 'plain')
  expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
})

test('a click on the chip opens a card with the picture, and a second closes it', async ($, on) => {
  const { runs } = setup(on)
  await sendImage($)
  const ui = await mountMessage($)

  await ui.press({ key: `chip:${UUID}:0` })
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  expect(await ui.find({ key: `expand:${UUID}:0` })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Image #1 · 8×4/ })).toBeDefined()
  expect(runsOf(runs, 'decode')[0]?.init?.stdin).toBe(PNG)

  await ui.press({ key: `chip:${UUID}:0` })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
})

test('the card decodes a picture once, however often it is drawn', async ($, on) => {
  const { runs } = setup(on)
  await sendImage($)
  const ui = await mountMessage($)

  await ui.press({ key: `chip:${UUID}:0` })
  await ui.press({ key: `chip:${UUID}:0` })
  await ui.press({ key: `chip:${UUID}:0` })
  expect(runsOf(runs, 'decode')).toHaveLength(1)
})

test('the card keeps the picture inside its small room', async ($, on) => {
  setup(on)
  await sendImage($)
  const ui = await mountMessage($)

  await ui.press({ key: `chip:${UUID}:0` })
  const raster = await ui.find({ type: 'Raster' })
  // Twice as wide as tall fills the 48 x 12 room: 48 pixels across, 24 down.
  expect(raster?.props).toMatchObject({ columns: 48, rows: 12 })
})

test('the card can be closed from its own corner', async ($, on) => {
  setup(on)
  await sendImage($)
  const ui = await mountMessage($)

  await ui.press({ key: `chip:${UUID}:0` })
  await ui.press({ key: `close:${UUID}:0` })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
})

test('⤢ opens the large pane, which draws the picture to its width', async ($, on) => {
  const { opened } = setup(on)
  await sendImage($)
  const ui = await mountMessage($)

  await ui.press({ key: `chip:${UUID}:0` })
  await ui.press({ key: `expand:${UUID}:0` })
  expect(opened).toEqual([expect.objectContaining({ id: 'image-preview', title: 'Image #1' })])

  const pane = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'image-preview' })
  expect((await pane.find({ type: 'Raster' }))?.props).toMatchObject({ columns: 60, rows: 15 })
})

test('an image the decoder cannot read says so in the card', async ($, on) => {
  setup(on, { decoder: { exitCode: 1, stdout: '', stderr: 'Parameter is not valid.\r\nmore' } })
  await sendImage($)
  const ui = await mountMessage($)

  await ui.press({ key: `chip:${UUID}:0` })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Cannot decode image/png: Parameter is not valid.' })).toBeDefined()
})

test('a sent image takes its number from the transcript line, not from a typed tag', async ($, on) => {
  const { clock, runs } = setup(on, { pasteIds: [{ exitCode: 0, stdout: '3', stderr: '' }] })
  await sendImage($, 'typed [Image #1] and pasted [Image #3]')
  const ui = await mountMessage($)
  // Two tags for one image: the text alone cannot say which.
  expect((await ui.find({ key: `chip:${UUID}:0` }))?.props.label).toBe('Image 1')

  await clock.advance(500)
  expect((await ui.find({ key: `chip:${UUID}:0` }))?.props.label).toBe('Image #3')
  expect(runsOf(runs, 'paste-ids')[0]?.argv).toEqual(expect.arrayContaining(['--path', TRANSCRIPT, '--uuid', UUID]))
})

test('a label waits for its transcript line to be written', async ($, on) => {
  const { clock, runs } = setup(on, {
    pasteIds: [
      { exitCode: 3, stdout: '', stderr: '' },
      { exitCode: 0, stdout: '3', stderr: '' },
    ],
  })
  await sendImage($, 'typed [Image #1] and pasted [Image #3]')
  const ui = await mountMessage($)

  await clock.advance(500)
  expect((await ui.find({ key: `chip:${UUID}:0` }))?.props.label).toBe('Image 1')
  await clock.advance(500)
  expect((await ui.find({ key: `chip:${UUID}:0` }))?.props.label).toBe('Image #3')
  expect(runsOf(runs, 'paste-ids')).toHaveLength(2)
})

test('a line that keeps no paste numbers leaves the labels as they were', async ($, on) => {
  const { clock } = setup(on, { pasteIds: [{ exitCode: 4, stdout: '', stderr: '' }] })
  await sendImage($)
  const ui = await mountMessage($)

  await clock.advance(500)
  expect((await ui.find({ key: `chip:${UUID}:0` }))?.props.label).toBe('Image #1')
})

// ── The draft ───────────────────────────────────────────────────────────────

test('a draft with no image leaves the band to the engine', async ($, on) => {
  const { clock } = setup(on)
  await $.session.start(SESSION)
  await clock.advance(200)

  const band = await mountBand($)
  expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await band.findAll({ type: 'Button' })).toHaveLength(0)
})

test('a pasted image shows as a chip above the prompt without another key', async ($, on) => {
  const { clock, draft } = setup(on)
  await $.session.start(SESSION)

  draft.text = 'look [Image #2]'
  await clock.advance(200)
  const band = await mountBand($)
  expect((await band.find({ key: 'chip:draft:2' }))?.props.label).toBe('Image #2')
})

test('a draft card shows the file Claude Code cached for that paste', async ($, on) => {
  const { clock, draft, runs } = setup(on)
  await $.session.start(SESSION)
  draft.text = '[Image #2]'
  await clock.advance(200)
  const band = await mountBand($)

  await band.press({ key: 'chip:draft:2' })
  expect(await band.find({ type: 'Raster' })).toBeDefined()
  const [decode] = runsOf(runs, 'decode')
  expect(decode?.argv).toEqual(expect.arrayContaining(['uv', '--script', '--path', `${PASTES}/2.png`]))
  expect(decode?.init?.stdin).toBeUndefined()
})

test('a paste cached under another extension is found by its number alone', async ($, on) => {
  const { clock, draft, runs } = setup(on)
  await $.session.start(SESSION)
  draft.text = '[Image #20]'
  await clock.advance(200)
  const band = await mountBand($)

  await band.press({ key: 'chip:draft:20' })
  expect(runsOf(runs, 'decode')[0]?.argv).toEqual(expect.arrayContaining(['--path', `${PASTES}/20.jpg`]))
})

test('on macOS the paste cache is found under /tmp/claude-<uid>', async ($, on) => {
  const { clock, draft, runs } = setup(on, { env: { HOME: '/Users/me' } })
  await $.session.start(SESSION)
  draft.text = '[Image #2]'
  await clock.advance(200)
  const band = await mountBand($)

  await band.press({ key: 'chip:draft:2' })
  expect(runsOf(runs, 'decode')[0]?.argv).toEqual(expect.arrayContaining(['--path', `${MAC_PASTES}/2.png`]))
})

test('a typed tag with no cached paste says so', async ($, on) => {
  const { clock, draft } = setup(on)
  await $.session.start(SESSION)
  draft.text = '[Image #7]'
  await clock.advance(200)
  const band = await mountBand($)

  await band.press({ key: 'chip:draft:7' })
  expect(await band.find({ type: 'Raster' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: /no pasted image #7/ })).toBeDefined()
})

test('the chips leave once the draft holds no tag', async ($, on) => {
  const { clock, draft } = setup(on)
  await $.session.start(SESSION)
  draft.text = '[Image #2]'
  await clock.advance(200)

  draft.text = ''
  await clock.advance(200)
  const band = await mountBand($)
  expect(await band.findAll({ type: 'Button' })).toHaveLength(0)
})

test('the band yields to a survey', async ($, on) => {
  const { clock, draft } = setup(on)
  await $.session.start(SESSION)
  draft.text = '[Image #2]'
  await clock.advance(200)

  const band = await mountBand($, { hasSurvey: true })
  expect(await band.findAll({ type: 'Button' })).toHaveLength(0)
})
