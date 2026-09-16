import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, RenderPropsOf, SessionStartInput } from 'claude-code'

const SESSION: SessionStartInput = { cwd: '/tmp/pet', surface: 'terminal', isInteractive: true }

const BAND_PROPS: RenderPropsOf['AbovePrompt'] = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}

/** A test's `$` calls `command.run` the way the engine does: the input whole. */
const run = ($: Engine, args: string) =>
  $.command.run({
    command: 'pet',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 80 },
  })

const band = ($: Engine, props: Partial<RenderPropsOf['AbovePrompt']> = {}) =>
  $.ui.render({
    surface: 'terminal',
    component: 'AbovePrompt',
    requestId: 'band',
    props: { ...BAND_PROPS, ...props },
  })

/** Every string the tree draws. */
function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (node && typeof node === 'object') {
    const { children } = node as { children?: unknown }
    return textOf(children)
  }
  return ''
}

/**
 * A test's `on` is the bottom of the chain: nothing beneath the plugins
 * answers, so everything the pet reaches for gets an implementation here.
 */
const setup = (on: On, wasVisible = true) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  // The test's `$` is the engine's: it has events, not a `store` noun. Standing
  // in for `mock.store` is what lets a test read back what the pet persisted.
  const store = new Map<string, unknown>([['visible', wasVisible]])
  on('store.get', ($, e) => ({ value: store.get(e.key) }))
  on('store.set', ($, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{''}</Text>
  })
  on('ui.invalidate', () => ({ value: undefined }))
  return { clock, store }
}

test('the band draws the pet while it is visible', async ($, on) => {
  setup(on)
  await $.session.start(SESSION)

  const drawn = textOf(await band($))
  expect(drawn).toContain('/\\_/\\')
  expect(drawn).toContain('Mochi')
})

test('a hidden pet leaves the band alone', async ($, on) => {
  setup(on, false)
  await $.session.start(SESSION)

  expect(textOf(await band($))).not.toContain('/\\_/\\')
})

test('the band yields to a survey', async ($, on) => {
  setup(on)
  await $.session.start(SESSION)

  expect(textOf(await band($, { hasSurvey: true }))).not.toContain('/\\_/\\')
})

test('a band too short to hold the drawing is left alone', async ($, on) => {
  setup(on)
  await $.session.start(SESSION)

  expect(textOf(await band($, { maxRows: 2 }))).not.toContain('/\\_/\\')
})

test('/pet toggles the band, and remembers which way', async ($, on) => {
  const { store } = setup(on)
  await $.session.start(SESSION)

  await run($, '')
  expect(textOf(await band($))).not.toContain('/\\_/\\')
  expect(store.get('visible')).toBe(false)

  await run($, '')
  expect(textOf(await band($))).toContain('/\\_/\\')
  expect(store.get('visible')).toBe(true)
})

test('/pet show and /pet hide say which way they went', async ($, on) => {
  setup(on)
  await $.session.start(SESSION)

  expect((await run($, 'hide')).text).toContain('went to sleep')
  expect((await run($, 'show')).text).toContain('is out')
})

test('an unknown argument answers with the usage line', async ($, on) => {
  setup(on)
  await $.session.start(SESSION)

  expect((await run($, 'feed')).text).toContain('Usage: /pet')
})

test('the pet blinks as the heartbeat runs', async ($, on) => {
  const { clock } = setup(on)
  await $.session.start(SESSION)

  const faces = new Set<string>()
  for (let tick = 0; tick < 10; tick += 1) {
    faces.add(textOf(await band($)))
    await clock.advance(700)
  }

  expect(faces.size).toBe(2)
})

test('the pet looks busy while a turn is running', async ($, on) => {
  setup(on)
  await $.session.start(SESSION)

  expect(textOf(await band($, { isWorking: true }))).toContain('.')
})
