import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Args, On, ProcessRunResult, RenderPropsOf } from 'claude-code'

const PLUGIN = 'image-preview'
const UUID = 'message-1'
const PNG = 'iVBORw0KGgo='

/** What the decoder answers for any picture: 8 x 4 pixels of red, scaled to 4 x 2. */
const DECODED = `8 4 4 2\n${new Uint8Array(4 * 2 * 4).map((_, i) => (i % 4 < 2 ? 0 : 255)).toBase64()}`

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

/**
 * A test's `on` is the bottom of the chain: the engine's own behaviour, and
 * the host's PowerShell, are answered here.
 */
const setup = (on: On, decoder: Pick<ProcessRunResult, 'exitCode' | 'stdout' | 'stderr'> = { exitCode: 0, stdout: DECODED, stderr: '' }) => {
  const runs: Args<'process.run'>[] = []
  const opened: Args<'ui.open'>[] = []

  on('process.run', ($, e) => {
    runs.push(e)
    return { value: { ...decoder, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.open', ($, e) => {
    opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{'engine'}</Text>
  })
  return { runs, opened }
}

/**
 * Appends a prompt row. The kit has no store beneath the chain for rows (a
 * test's own hook may not answer one without `next`), so the append rejects
 * once the plugin has seen the row; what the plugin kept is what is tested.
 */
const append = ($: Engine, row: Args<'session.append'>) => $.session.append(row).catch(() => undefined)

const sendImage = ($: Engine) =>
  append(
    $,
    promptRow(UUID, [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } },
      { type: 'text', text: '[Image #1] what is this?' },
    ]),
  )

const mountMessage = ($: Engine, requestId = UUID) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'UserMessage', props: userMessage('[Image #1] what is this?'), requestId, viewport: { columns: 100, rows: 40 } })

test('a sent image becomes a chip under its prompt', async ($, on) => {
  setup(on)
  await sendImage($)

  const ui = await mountMessage($)
  expect((await ui.find({ type: 'Text', text: 'engine' }))).toBeDefined()
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
  expect((await ui.find({ type: 'Text', text: /Image #1 · 8×4/ }))).toBeDefined()
  expect(runs[0]?.init?.stdin).toBe(PNG)

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
  expect(runs.filter((run) => run.argv.includes('decode'))).toHaveLength(1)
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

// The draft's chips come from `prompt.edit`, which this build's test kit
// cannot raise (its `$.prompt` has no `edit`); that path is tried by hand.

test('a draft with no image leaves the band to the engine', async ($, on) => {
  setup(on)

  const band = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
  expect(await band.findAll({ type: 'Button' })).toHaveLength(0)
})

test('an image the decoder cannot read says so in the card', async ($, on) => {
  setup(on, { exitCode: 1, stdout: '', stderr: 'Parameter is not valid.\r\nmore' })
  await sendImage($)
  const ui = await mountMessage($)

  await ui.press({ key: `chip:${UUID}:0` })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Cannot decode this image/png: Parameter is not valid.' })).toBeDefined()
})
