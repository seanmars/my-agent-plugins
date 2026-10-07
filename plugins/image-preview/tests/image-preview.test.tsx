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
 * its temp folder as `claude` under TEMP, macOS as `claude-<uid>` under /tmp;
 * `CLAUDE_CODE_TMPDIR` moves either one under it.
 */
const PASTES = 'C:/Temp/claude/C--work/session-1/images'
const NEXT_PASTES = 'C:/Temp/claude/C--work/session-2/images'
const MAC_PASTES = '/tmp/claude-501/-Users-me-work/session-1/images'
const CUSTOM_PASTES = 'D:/ctmp/claude/C--work/session-1/images'
const CUSTOM_MAC_PASTES = '/var/ctmp/claude-501/-Users-me-work/session-1/images'
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
    'C:/Temp': [entry('claude', 'dir'), entry('claude-notes', 'dir'), entry('other', 'dir')],
    'C:/Temp/claude': [entry('C--elsewhere', 'dir'), entry('C--work', 'dir')],
    [PASTES]: [entry('2.png', 'file'), entry('20.jpg', 'file')],
    [NEXT_PASTES]: [entry('2.png', 'file')],
    '/tmp':[entry('claude-0', 'dir'), entry('claude-501', 'dir'), entry('claude-notes', 'dir')],
    '/tmp/claude-501': [entry('-Users-me-work', 'dir')],
    [MAC_PASTES]: [entry('2.png', 'file')],
    'D:/ctmp': [entry('claude', 'dir')],
    'D:/ctmp/claude': [entry('C--work', 'dir')],
    [CUSTOM_PASTES]: [entry('2.png', 'file')],
    '/var/ctmp': [entry('claude-501', 'dir')],
    '/var/ctmp/claude-501': [entry('-Users-me-work', 'dir')],
    [CUSTOM_MAC_PASTES]: [entry('2.png', 'file')],
    'C:/Users/me/.claude/projects': [entry('C--work', 'dir')],
  }).map(([path, entries]) => [fsKey(path), entries]),
)
const PRESENT = new Set([PASTES, NEXT_PASTES, MAC_PASTES, CUSTOM_PASTES, CUSTOM_MAC_PASTES, TRANSCRIPT].map(fsKey))
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
  const draft = { text: '', reads: 0 }
  const session = { id: 'session-1' }
  const runs: Args<'process.run'>[] = []
  const opened: Args<'ui.open'>[] = []
  /** Panes the person closed: `ui.panes` no longer lists them. */
  const closed = new Set<string>()
  const pasteIds = [...(host.pasteIds ?? [{ exitCode: 3, stdout: '', stderr: '' }])]

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: session.id }))
  on('classic.SessionStart', () => ({}))
  on('classic.UserPromptSubmit', () => ({}))
  on('prompt.read', () => {
    draft.reads += 1
    return { value: { text: draft.text, cursor: draft.text.length } }
  })
  on('fs.list', ($, e) => ({ value: FOLDERS.get(fsKey(e.path)) ?? [] }))
  on('fs.exists', ($, e) => ({ value: PRESENT.has(fsKey(e.path)) }))
  on('process.run', ($, e) => {
    runs.push(e)
    const answer =
      e.argv.some((arg) => arg.endsWith('/paste_ids.py'))
        ? (pasteIds.length > 1 ? pasteIds.shift() : pasteIds[0])
        : (host.decoder ?? { exitCode: 0, stdout: DECODED, stderr: '' })
    return { value: { exitCode: 1, stdout: '', stderr: '', ...answer, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => {
    const titles = new Map(opened.filter((open) => !closed.has(open.id)).map((open) => [open.id, open.title ?? open.id]))
    const panes = [...titles].map(([id, title]) => ({ id, title, isShown: true, isFocused: false, isPlaced: true }))
    return { value: panes }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{'engine'}</Text>
  })
  return { clock, draft, session, runs, opened, closed }
}

/** The runs of one helper: the decoder's by its `decode` mode, the paste numbers' by `paste_ids.py`. */
const runsOf = (runs: Args<'process.run'>[], part: string) =>
  runs.filter((run) => run.argv.some((arg) => arg === part || arg.endsWith(`/${part}`)))
/** The file each decode read, in order. */
const decodedPaths = (runs: Args<'process.run'>[]) => runsOf(runs, 'decode').map((run) => run.argv.at(-1))

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

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', props: PANE_PROPS, requestId: 'image-preview' })

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

  const pane = await mountPane($)
  expect((await pane.find({ type: 'Raster' }))?.props).toMatchObject({ columns: 60, rows: 15 })
})

test('only the last few decoded pictures stay held', async ($, on) => {
  const { runs } = setup(on)
  const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } } as const
  await append($, promptRow(UUID, Array.from({ length: 9 }, () => image)))
  const ui = await mountMessage($)

  for (let index = 0; index < 9; index++) await ui.press({ key: `chip:${UUID}:${index}` })
  expect(runsOf(runs, 'decode')).toHaveLength(9)
  // Eight stay: the last one opened is held, the first one is decoded again.
  await ui.press({ key: `chip:${UUID}:7` })
  expect(runsOf(runs, 'decode')).toHaveLength(9)
  await ui.press({ key: `chip:${UUID}:0` })
  expect(runsOf(runs, 'decode')).toHaveLength(10)
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
  expect(runsOf(runs, 'paste_ids.py')[0]?.argv).toEqual(expect.arrayContaining(['--path', TRANSCRIPT, '--uuid', UUID]))
})

test('the transcript a submitted prompt names is read, not searched for', async ($, on) => {
  const { clock, runs } = setup(on, { pasteIds: [{ exitCode: 0, stdout: '3', stderr: '' }] })
  const named = 'E:/moved/C--work/session-1.jsonl'
  await $.classic.UserPromptSubmit({ prompt: 'pasted [Image #3]', session_id: 'session-1', transcript_path: named })
  await sendImage($, 'typed [Image #1] and pasted [Image #3]')

  await clock.advance(500)
  expect(runsOf(runs, 'paste_ids.py')[0]?.argv).toEqual(expect.arrayContaining(['--path', named]))
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
  expect(runsOf(runs, 'paste_ids.py')).toHaveLength(2)
})

test('a new label reaches the open pane, its caption and its title', async ($, on) => {
  const { clock, opened } = setup(on, { pasteIds: [{ exitCode: 0, stdout: '3', stderr: '' }] })
  await sendImage($, 'typed [Image #1] and pasted [Image #3]')
  const ui = await mountMessage($)
  await ui.press({ key: `chip:${UUID}:0` })
  await ui.press({ key: `expand:${UUID}:0` })
  expect(opened.at(-1)?.title).toBe('Image 1')

  await clock.advance(500)
  expect(opened.at(-1)?.title).toBe('Image #3')
  const pane = await mountPane($)
  expect(await pane.find({ type: 'Text', text: /^Image #3 · 8×4/ })).toBeDefined()
})

test('a new label leaves a closed pane closed', async ($, on) => {
  const { clock, opened, closed } = setup(on, { pasteIds: [{ exitCode: 0, stdout: '3', stderr: '' }] })
  await sendImage($, 'typed [Image #1] and pasted [Image #3]')
  const ui = await mountMessage($)
  await ui.press({ key: `chip:${UUID}:0` })
  await ui.press({ key: `expand:${UUID}:0` })
  closed.add('image-preview')

  await clock.advance(500)
  expect(opened).toHaveLength(1)
})

test('once its paste is known a sent image is read from the cached file, not kept bytes', async ($, on) => {
  const { clock, runs } = setup(on, { pasteIds: [{ exitCode: 0, stdout: '2', stderr: '' }] })
  await sendImage($, '[Image #2] what is this?')
  await clock.advance(500)

  const ui = await mountMessage($)
  await ui.press({ key: `chip:${UUID}:0` })
  expect(decodedPaths(runs)).toEqual([`${PASTES}/2.png`])
  expect(runsOf(runs, 'decode')[0]?.init?.stdin).toBeUndefined()
})

test('a sent image whose paste is not cached keeps its bytes', async ($, on) => {
  const { clock, runs } = setup(on, { pasteIds: [{ exitCode: 0, stdout: '7', stderr: '' }] })
  await sendImage($, '[Image #7] what is this?')
  await clock.advance(500)

  const ui = await mountMessage($)
  await ui.press({ key: `chip:${UUID}:0` })
  expect(runsOf(runs, 'decode')[0]?.init?.stdin).toBe(PNG)
})

test('a line that keeps no paste numbers leaves the labels as they were', async ($, on) => {
  const { clock } = setup(on, { pasteIds: [{ exitCode: 4, stdout: '', stderr: '' }] })
  await sendImage($)
  const ui = await mountMessage($)

  await clock.advance(500)
  expect((await ui.find({ key: `chip:${UUID}:0` }))?.props.label).toBe('Image #1')
})

// ── The draft ───────────────────────────────────────────────────────────────

test('a session with no person at a terminal prompt reads no draft', async ($, on) => {
  const { clock, draft } = setup(on)
  await $.session.start({ cwd: 'C:/work', surface: null, isInteractive: false })

  await clock.advance(1000)
  expect(draft.reads).toBe(0)
})

test('another session.start adds no second draft timer', async ($, on) => {
  const { clock, draft } = setup(on)
  await $.session.start(SESSION)
  await $.session.start(SESSION)

  await clock.advance(200)
  expect(draft.reads).toBe(1)
})

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

test('CLAUDE_CODE_TMPDIR moves the temp folder under it, not in its place', async ($, on) => {
  const { clock, draft, runs } = setup(on, { env: { ...WINDOWS_ENV, CLAUDE_CODE_TMPDIR: 'D:/ctmp/' } })
  await $.session.start(SESSION)
  draft.text = '[Image #2]'
  await clock.advance(200)
  const band = await mountBand($)

  await band.press({ key: 'chip:draft:2' })
  expect(runsOf(runs, 'decode')[0]?.argv).toEqual(expect.arrayContaining(['--path', `${CUSTOM_PASTES}/2.png`]))
})

test('on macOS CLAUDE_CODE_TMPDIR holds the claude-<uid> folder', async ($, on) => {
  const { clock, draft, runs } = setup(on, { env: { HOME: '/Users/me', CLAUDE_CODE_TMPDIR: '/var/ctmp' } })
  await $.session.start(SESSION)
  draft.text = '[Image #2]'
  await clock.advance(200)
  const band = await mountBand($)

  await band.press({ key: 'chip:draft:2' })
  expect(runsOf(runs, 'decode')[0]?.argv).toEqual(expect.arrayContaining(['--path', `${CUSTOM_MAC_PASTES}/2.png`]))
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

test('a draft write that fails is written again on the next tick', async ($, on) => {
  const { clock, draft } = setup(on)
  let refusals = 1
  on('state.set', ($, e, next) => (e.key === 'draftImages' && refusals-- > 0 ? { deny: 'busy' } : next(e)))
  await $.session.start(SESSION)

  draft.text = '[Image #2]'
  await clock.advance(200)
  await clock.advance(200)
  const band = await mountBand($)
  expect((await band.find({ key: 'chip:draft:2' }))?.props.label).toBe('Image #2')
})

test('after a session switch a draft tag shows the paste of the new session', async ($, on) => {
  const { clock, draft, session, runs } = setup(on)
  await $.session.start(SESSION)
  draft.text = '[Image #2]'
  await clock.advance(200)
  const band = await mountBand($)
  await band.press({ key: 'chip:draft:2' })
  await band.press({ key: 'chip:draft:2' })

  // `/resume`: the recalled draft names the other session's paste #2.
  session.id = 'session-2'
  await $.classic.SessionStart({ source: 'resume', session_id: 'session-2' })
  await clock.advance(200)
  const resumed = await mountBand($)
  await resumed.press({ key: 'chip:draft:2' })
  expect(decodedPaths(runs)).toEqual([`${PASTES}/2.png`, `${NEXT_PASTES}/2.png`])
})

test('two drawings of one picture at once decode it once', async ($, on) => {
  const { clock, draft, runs } = setup(on)
  await $.session.start(SESSION)
  draft.text = '[Image #2]'
  await clock.advance(200)
  const band = await mountBand($)
  await band.press({ key: 'chip:draft:2' })
  await band.press({ key: 'expand:draft:2' })

  // The decoded pixels are dropped; the card and the pane then ask for them together.
  await $.classic.SessionStart({ source: 'compact' })
  await Promise.all([mountBand($), mountPane($)])
  expect(runsOf(runs, 'decode')).toHaveLength(2)
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
