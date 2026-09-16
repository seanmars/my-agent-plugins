/**
 * pet — a small companion drawn in the band above the prompt.
 *
 * It has no state to keep but whether it is on screen: the pet blinks on the
 * heartbeat and looks busy while a turn runs, and that is all it does.
 *
 * The art lives only in `sprite()`, so the terminal's `Raster` element can
 * replace it later without touching anything else.
 *
 * Everything that takes `$` is a top-level declaration: the loader inventories
 * what a hooks module reaches for, and refuses `$` passed into a closure it
 * cannot see.
 */
import type { EngineInterface, Register, Timer } from 'claude-code'

const STORE_KEY = 'visible'
const TICK_MS = 700
/** One tick of every eight is a blink, so the pet blinks about every 5 s. */
const BLINK_EVERY = 8
const COLOR = 'cyan'

const EARS = '  /\\_/\\'
const EYES_OPEN = ' ( o.o )'
const EYES_SHUT = ' ( -.- )'
const PAWS = '  > ^ <'

let petName = 'Mochi'
let showOnStart = true
let visible = true
let heartbeat: Timer | undefined
let frame = 0

/** Three lines of art, plus whatever floats beside the face this frame. */
function sprite(isWorking: boolean): readonly string[] {
  const blinking = frame % BLINK_EVERY === 0
  const tag = isWorking ? ' .'.repeat((frame % 3) + 1) : ''
  return [EARS, `${blinking ? EYES_SHUT : EYES_OPEN}${tag}`, PAWS]
}

function startHeartbeat($: EngineInterface): void {
  if (heartbeat) return
  heartbeat = $.clock.every(TICK_MS, () => {
    frame += 1
    $.ui.invalidate('ui.render')
  })
}

function stopHeartbeat(): void {
  heartbeat?.cancel()
  heartbeat = undefined
}

async function setVisible($: EngineInterface, next: boolean): Promise<void> {
  visible = next
  if (visible) startHeartbeat($)
  else stopHeartbeat()
  await $.store.set(STORE_KEY, visible)
  $.ui.invalidate('ui.render')
}

export const register: Register = (on, options) => {
  petName = typeof options.petName === 'string' && options.petName.trim()
    ? options.petName.trim()
    : 'Mochi'
  showOnStart = options.showOnStart !== false
  visible = showOnStart

  on('session.start', async ($, e, next) => {
    const stored = await $.store.get(STORE_KEY)
    visible = typeof stored === 'boolean' ? stored : showOnStart

    await $.command.register({
      name: 'pet',
      description: `Show ${petName}, a small pet above the prompt.`,
      argumentHint: '[show|hide]',
    })

    if (visible) startHeartbeat($)
    return next(e)
  })

  on('command.run', { command: 'pet' }, async ($, e) => {
    switch (e.args.trim().toLowerCase()) {
      case '':
        await setVisible($, !visible)
        return { text: visible ? `${petName} is out.` : `${petName} went to sleep.` }
      case 'show':
        await setVisible($, true)
        return { text: `${petName} is out.` }
      case 'hide':
        await setVisible($, false)
        return { text: `${petName} went to sleep.` }
      default:
        return { text: 'Usage: /pet [show|hide]' }
    }
  })

  on('ui.render', { component: 'AbovePrompt', surface: 'terminal' }, async ($, e, next) => {
    // A survey owns the band while it is up, and the drawing needs four rows.
    if (!visible || e.props.hasSurvey || e.props.maxRows < 4) return next(e)

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box width={e.props.bodyColumns} flexDirection="row" justifyContent="flex-end">
        <Box flexDirection="column" alignItems="flex-start" marginRight={1}>
          {sprite(e.props.isWorking).map((line) => (
            <Text color={COLOR} wrap="truncate-end">{line}</Text>
          ))}
          <Text dimColor>{petName}</Text>
        </Box>
      </Box>
    )
  })
}
