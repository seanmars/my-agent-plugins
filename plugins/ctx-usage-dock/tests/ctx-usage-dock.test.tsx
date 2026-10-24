import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { Args, On, RenderPropsOf, SessionContextBreakdown, SessionStartInput, SessionUsage } from 'claude-code'

const PLUGIN = 'ctx-usage-dock'
const SESSION: SessionStartInput = { cwd: 'C:/work', surface: 'terminal', isInteractive: true }

const PANE_PROPS: RenderPropsOf['Pane'] = {
  title: 'Context',
  isFocused: false,
  bodyColumns: 40,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
}

const BREAKDOWN: SessionContextBreakdown = {
  categories: [
    { name: 'System prompt', tokens: 3_000, color: 'promptBorder', isDeferred: false, kind: 'used' },
    { name: 'MCP tools', tokens: 5_000, color: 'cyan_FOR_SUBAGENTS_ONLY', isDeferred: false, kind: 'used' },
    { name: 'Messages', tokens: 30_000, color: 'purple_FOR_SUBAGENTS_ONLY', isDeferred: false, kind: 'used' },
    { name: 'Free space', tokens: 162_000, color: 'inactive', isDeferred: false, kind: 'free' },
  ],
  totalTokens: 38_000,
  maxTokens: 200_000,
  rawMaxTokens: 200_000,
  autocompactSource: 'auto',
  percentage: 19,
  gridRows: [],
  model: 'claude-opus-5-5',
  memoryFiles: [
    { path: 'C:\\Users\\me\\.claude\\CLAUDE.md', type: 'User', tokens: 1_200 },
    { path: 'C:/work/.claude/rules/style.md', type: 'Project', tokens: 400 },
  ],
  mcpTools: [
    { name: 'mcp__linear__create_issue', serverName: 'linear', tokens: 2_000, isLoaded: true },
    { name: 'mcp__linear__search', serverName: 'linear', tokens: 3_000, isLoaded: true },
    { name: 'mcp__linear__delete', serverName: 'linear', tokens: 900, isLoaded: false },
  ],
  agents: [],
  skills: {
    totalSkills: 2,
    includedSkills: 2,
    tokens: 700,
    skillFrontmatter: [
      { name: 'group-commit', source: 'plugin', pluginName: 'group-commit', tokens: 500 },
      { name: 'init', source: 'built-in', tokens: 200 },
    ],
  },
  isAutoCompactEnabled: true,
  autoCompactThreshold: 167_000,
  apiUsage: null,
}

/** Answers `$.session.usage` with BREAKDOWN, and keeps what each call asked and each status line. */
function setup(on: On) {
  const asked: Args<'session.usage'>[] = []
  const statuses: (string | undefined)[] = []
  on('command.register', () => ({ value: { command: PLUGIN } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: Date.UTC(2026, 9, 24, 4, 5) }))
  on('session.usage', (_, e) => {
    asked.push(e)
    const usage: SessionUsage = { startedAt: 0, context: { window: 200_000, breakdown: BREAKDOWN }, rateLimits: [] }
    return { value: usage }
  })
  on('ui.status', (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  return { asked, statuses }
}

const mountPane = ($: Engine) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'Pane', requestId: 'ctx-usage', props: PANE_PROPS })

test('a new session counts with the summary estimate and fills the status line', async ($, on) => {
  const { asked, statuses } = setup(on)
  await $.session.start(SESSION)

  expect(asked.map((one) => one.breakdown)).toEqual(['summary'])
  expect(statuses.at(-1)).toBe('ctx 19% 38.0k/200.0k │ Messages 30.0k · MCP tools 5.0k · System prompt 3.0k')
})

test('the pane lists categories and groups, rules apart from memory', async ($, on) => {
  setup(on)
  await $.session.start(SESSION)
  const ui = await mountPane($)

  expect(await ui.find({ type: 'Text', text: '19% · 38.0k / 200.0k' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Messages' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '30.0k 15.0%' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Skills (2/2 listed)' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  linear · 2/3 loaded' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  .claude/CLAUDE.md · User' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Rules' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '  rules/style.md · Project' })).toBeDefined()
  await ui.unmount()
})

test('Full count asks the token-count API', async ($, on) => {
  const { asked } = setup(on)
  await $.session.start(SESSION)
  const ui = await mountPane($)

  await ui.press({ key: 'Full count' })

  expect(asked.map((one) => one.breakdown)).toEqual(['summary', 'full'])
  expect(await ui.find({ type: 'Text', text: /full/ })).toBeDefined()
  await ui.unmount()
})

test('before any count the pane says so', async ($, on) => {
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000 }, rateLimits: [] } }))
  const ui = await mountPane($)

  expect(await ui.find({ type: 'Text', text: 'No count yet. Press Refresh.' })).toBeDefined()
  await ui.unmount()
})
