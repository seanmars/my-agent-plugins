import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Args, FsEntry, On, ProcessRunResult, RenderPropsOf, SessionStartInput } from 'claude-code'

const PLUGIN = 'image-preview'
const UUID = 'message-1'
const PNG = 'iVBORw0KGgo='
const SESSION: SessionStartInput = { cwd: 'C:/work', surface: 'terminal', isInteractive: true }

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
  /** What each look for paste numbers answers in turn; the last repeats. */
  pasteIds?: Answer[]
  /** What the system viewer's helper answers. */
  viewer?: Answer
  /** The environment the plugin reads; Windows' when not given. */
  env?: Record<string, string>
}

/**
 * A test's `on` is the bottom of the chain: the engine's own behaviour, the
 * prompt box, Claude Code's files and the uv helpers are answered here.
 */
const setup = (on: On, host: Host = {}) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, host.env ?? WINDOWS_ENV)
  const draft = { text: '', reads: 0 }
  const session = { id: 'session-1' }
  const runs: Args<'process.run'>[] = []
  const toasts: string[] = []
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
    const answer = e.argv.some((arg) => arg.endsWith('/paste_ids.py'))
      ? (pasteIds.length > 1 ? pasteIds.shift() : pasteIds[0])
      : (host.viewer ?? { exitCode: 0, stdout: '', stderr: '' })
    return { value: { exitCode: 1, stdout: '', stderr: '', ...answer, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', ($, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{'engine'}</Text>
  })
  return { clock, draft, session, runs, toasts }
}

/** The runs of one helper, by its script name. */
const runsOf = (runs: Args<'process.run'>[], script: string) => runs.filter((run) => run.argv.some((arg) => arg.endsWith(`/${script}`)))
const opens = (runs: Args<'process.run'>[]) => runsOf(runs, 'open_image.py')
/** The file each open of the viewer named, in order. */
const openedPaths = (runs: Args<'process.run'>[]) => opens(runs).map((run) => run.argv.at(-1))

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

/** Starts a terminal session whose draft holds `text`, read by one tick, and mounts the band. */
const draftBand = async ($: Engine, on: On, text: string, host: Host = {}) => {
  const kit = setup(on, host)
  await $.session.start(SESSION)
  kit.draft.text = text
  await kit.clock.advance(200)
  return { ...kit, band: await mountBand($) }
}


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

test('a click on a sent chip opens the picture in the system viewer from the bytes it carried', async ($, on) => {
  const { runs } = setup(on)
  await sendImage($)
  const ui = await mountMessage($)

  await ui.press({ key: `chip:${UUID}:0` })
  const [open] = opens(runs)
  expect(open?.argv).toEqual(expect.arrayContaining(['uv', '--script', '--media-type', 'image/png']))
  expect(open?.init?.stdin).toBe(PNG)
})

test('every click opens the picture again, and no card is drawn', async ($, on) => {
  const { runs } = setup(on)
  await sendImage($)
  const ui = await mountMessage($)

  await ui.press({ key: `chip:${UUID}:0` })
  await ui.press({ key: `chip:${UUID}:0` })
  expect(opens(runs)).toHaveLength(2)
  expect(await ui.findAll({ type: 'Raster' })).toHaveLength(0)
})

test('a viewer that cannot open the picture says so in a toast', async ($, on) => {
  const { toasts } = setup(on, { viewer: { exitCode: 1, stdout: '', stderr: 'OSError: no app\r\nmore' } })
  await sendImage($)
  const ui = await mountMessage($)

  await ui.press({ key: `chip:${UUID}:0` })
  expect(toasts).toEqual(['Cannot open Image #1: OSError: no app'])
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

test('once its paste is known a sent image opens from the cached file, not kept bytes', async ($, on) => {
  const { clock, runs } = setup(on, { pasteIds: [{ exitCode: 0, stdout: '2', stderr: '' }] })
  await sendImage($, '[Image #2] what is this?')
  await clock.advance(500)

  const ui = await mountMessage($)
  await ui.press({ key: `chip:${UUID}:0` })
  expect(openedPaths(runs)).toEqual([`${PASTES}/2.png`])
  expect(opens(runs)[0]?.init?.stdin).toBeUndefined()
})

test('a sent image whose paste is not cached keeps its bytes', async ($, on) => {
  const { clock, runs } = setup(on, { pasteIds: [{ exitCode: 0, stdout: '7', stderr: '' }] })
  await sendImage($, '[Image #7] what is this?')
  await clock.advance(500)

  const ui = await mountMessage($)
  await ui.press({ key: `chip:${UUID}:0` })
  expect(opens(runs)[0]?.init?.stdin).toBe(PNG)
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
  const { band } = await draftBand($, on, '')
  expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await band.findAll({ type: 'Button' })).toHaveLength(0)
})

test('a pasted image shows as a chip above the prompt without another key', async ($, on) => {
  const { band } = await draftBand($, on, 'look [Image #2]')
  expect((await band.find({ key: 'chip:draft:2' }))?.props.label).toBe('Image #2')
})

test('a click on a draft chip opens the file Claude Code cached for that paste', async ($, on) => {
  const { band, runs } = await draftBand($, on, '[Image #2]')

  await band.press({ key: 'chip:draft:2' })
  const [open] = opens(runs)
  expect(open?.argv).toEqual(expect.arrayContaining(['uv', '--script', '--path', `${PASTES}/2.png`]))
  expect(open?.init?.stdin).toBeUndefined()
})

test('a paste cached under another extension is found by its number alone', async ($, on) => {
  const { band, runs } = await draftBand($, on, '[Image #20]')

  await band.press({ key: 'chip:draft:20' })
  expect(openedPaths(runs)).toEqual([`${PASTES}/20.jpg`])
})

test('on macOS the paste cache is found under /tmp/claude-<uid>', async ($, on) => {
  const { band, runs } = await draftBand($, on, '[Image #2]', { env: { HOME: '/Users/me' } })

  await band.press({ key: 'chip:draft:2' })
  expect(openedPaths(runs)).toEqual([`${MAC_PASTES}/2.png`])
})

test('CLAUDE_CODE_TMPDIR moves the temp folder under it, not in its place', async ($, on) => {
  const { band, runs } = await draftBand($, on, '[Image #2]', { env: { ...WINDOWS_ENV, CLAUDE_CODE_TMPDIR: 'D:/ctmp/' } })

  await band.press({ key: 'chip:draft:2' })
  expect(openedPaths(runs)).toEqual([`${CUSTOM_PASTES}/2.png`])
})

test('on macOS CLAUDE_CODE_TMPDIR holds the claude-<uid> folder', async ($, on) => {
  const { band, runs } = await draftBand($, on, '[Image #2]', { env: { HOME: '/Users/me', CLAUDE_CODE_TMPDIR: '/var/ctmp' } })

  await band.press({ key: 'chip:draft:2' })
  expect(openedPaths(runs)).toEqual([`${CUSTOM_MAC_PASTES}/2.png`])
})

test('a typed tag with no cached paste says so in a toast', async ($, on) => {
  const { band, runs, toasts } = await draftBand($, on, '[Image #7]')

  await band.press({ key: 'chip:draft:7' })
  expect(opens(runs)).toHaveLength(0)
  expect(toasts).toEqual(['Cannot open Image #7: Claude Code holds no pasted image #7 in this session.'])
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

test('after a session switch a draft tag opens the paste of the new session', async ($, on) => {
  const { band, clock, session, runs } = await draftBand($, on, '[Image #2]')
  await band.press({ key: 'chip:draft:2' })

  // `/resume`: the recalled draft names the other session's paste #2.
  session.id = 'session-2'
  await $.classic.SessionStart({ source: 'resume', session_id: 'session-2' })
  await clock.advance(200)
  const resumed = await mountBand($)
  await resumed.press({ key: 'chip:draft:2' })
  expect(openedPaths(runs)).toEqual([`${PASTES}/2.png`, `${NEXT_PASTES}/2.png`])
})

test('the chips leave once the draft holds no tag', async ($, on) => {
  const { clock, draft } = await draftBand($, on, '[Image #2]')

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
