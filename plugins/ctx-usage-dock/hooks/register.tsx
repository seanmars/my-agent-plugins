/**
 * ctx-usage-dock: the context window broken down by category, as /context
 * breaks it down, in a pane docked beside the transcript and on the status line.
 *
 * Each main-loop turn, compaction and new session recounts with the free
 * `summary` estimate; the pane's `Full count` button asks the token-count API
 * for each category, as /context does.
 *
 * `/ctx-usage-dock off` closes the pane, clears the status line and stops the
 * counting, in this session and the next ones, until `/ctx-usage-dock on`.
 *
 * Everything that takes `$` is a top-level declaration: the loader inventories
 * what a hooks module reaches for through `$`.
 */
import { atom, read, update } from 'claude-code'
import type { ContextBreakdownDetail, EngineInterface, RenderElement, Register, SessionContextBreakdown } from 'claude-code'

import type { UsageCategory, UsageGroup, UsageItem, UsageSnapshot } from '../types'

const PLUGIN = 'ctx-usage-dock'
const PANE = 'ctx-usage'
const TITLE = 'Context'
/** Items listed under a group before `+N more`. */
const TOP_ITEMS = 8
/** Categories the status line names after the percentage. */
const STATUS_CATEGORIES = 3
/** A rules file sits in a `.claude/rules` folder; every other memory file is memory. */
const RULES_PATH = /[\\/]\.claude[\\/]rules[\\/]/
/** The `$.store` key that keeps the on/off switch across sessions; unset is on. */
const ENABLED_KEY = 'enabled'

// Change the tag when UsageSnapshot's fields change: it declines what an
// earlier version stored, which outlives a reload.
const snapshot = atom({ plugin: 'ctx-usage-dock', key: 'snapshot' } as const, null, { shape: 'snapshot-1' })
const isCounting = atom({ plugin: 'ctx-usage-dock', key: 'isCounting' } as const, false)

/** One count at a time: a turn that ends while a full count runs waits for the next. */
let isRunning = false

// ── Numbers ─────────────────────────────────────────────────────────────────

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

function formatPercent(tokens: number, max: number): string {
  return max > 0 ? `${((tokens / max) * 100).toFixed(1)}%` : ''
}

function formatTime(epochMs: number): string {
  const at = new Date(epochMs)
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** The last two segments of a path: `.claude/CLAUDE.md`. */
function shortPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).slice(-2).join('/')
}

const byTokens = (a: { tokens: number }, b: { tokens: number }) => b.tokens - a.tokens
const sumTokens = (items: readonly { tokens: number }[]) => items.reduce((sum, item) => sum + item.tokens, 0)

// ── Breakdown to snapshot ───────────────────────────────────────────────────

function group(title: string, items: UsageItem[], note?: string): UsageGroup {
  return { title, tokens: sumTokens(items), note, items: [...items].sort(byTokens) }
}

/** One item per MCP server: the tokens of its loaded schemas, and how many are loaded. */
function mcpServers(breakdown: SessionContextBreakdown): UsageItem[] {
  const servers = new Map<string, { tokens: number; loaded: number; total: number }>()
  for (const tool of breakdown.mcpTools) {
    const server = servers.get(tool.serverName) ?? { tokens: 0, loaded: 0, total: 0 }
    server.total += 1
    if (tool.isLoaded) {
      server.loaded += 1
      server.tokens += tool.tokens
    }
    servers.set(tool.serverName, server)
  }
  return [...servers].map(([name, server]) => ({
    label: name,
    tokens: server.tokens,
    note: `${server.loaded}/${server.total} loaded`,
  }))
}

function memoryItems(breakdown: SessionContextBreakdown, isRules: boolean): UsageItem[] {
  return breakdown.memoryFiles
    .filter((file) => RULES_PATH.test(file.path) === isRules)
    .map((file) => ({ label: shortPath(file.path), tokens: file.tokens, note: file.type }))
}

function toSnapshot(breakdown: SessionContextBreakdown, detail: ContextBreakdownDetail, countedAt: number): UsageSnapshot {
  const { skills, slashCommands } = breakdown
  const groups = [
    skills &&
      group(
        'Skills',
        skills.skillFrontmatter.map((skill) => ({ label: skill.name, tokens: skill.tokens, note: skill.pluginName })),
        `${skills.includedSkills}/${skills.totalSkills} listed`,
      ),
    breakdown.mcpTools.length > 0 && group('MCP servers', mcpServers(breakdown)),
    group('Memory files', memoryItems(breakdown, false)),
    group('Rules', memoryItems(breakdown, true)),
    breakdown.agents.length > 0 &&
      group('Agents', breakdown.agents.map((agent) => ({ label: agent.agentType, tokens: agent.tokens, note: agent.source }))),
    slashCommands && {
      title: 'Slash commands',
      tokens: slashCommands.tokens,
      note: `${slashCommands.includedCommands}/${slashCommands.totalCommands} listed`,
      items: [],
    },
  ].filter((one): one is UsageGroup => Boolean(one) && (one as UsageGroup).tokens > 0)

  return {
    detail,
    countedAt,
    model: breakdown.model,
    totalTokens: breakdown.totalTokens,
    maxTokens: breakdown.rawMaxTokens,
    percentage: breakdown.percentage,
    autoCompactAt: breakdown.isAutoCompactEnabled ? breakdown.autoCompactThreshold : undefined,
    categories: breakdown.categories.map(({ name, tokens, color, kind }) => ({ name, tokens, color, kind })),
    groups,
  }
}

/** `ctx 42% 84.2k/200k │ Messages 30.1k · System tools 12.4k · MCP tools 8.0k` */
function statusLine(snap: UsageSnapshot): string {
  const head = `ctx ${snap.percentage}% ${formatTokens(snap.totalTokens)}/${formatTokens(snap.maxTokens)}`
  const top = snap.categories
    .filter((category) => category.kind === 'used' && category.tokens > 0)
    .sort(byTokens)
    .slice(0, STATUS_CATEGORIES)
    .map((category) => `${category.name} ${formatTokens(category.tokens)}`)
  return top.length > 0 ? `${head} │ ${top.join(' · ')}` : head
}

// ── On and off ──────────────────────────────────────────────────────────────

async function isEnabled($: EngineInterface): Promise<boolean> {
  return (await $.store.get(ENABLED_KEY)) !== false
}

async function turnOn($: EngineInterface): Promise<void> {
  await $.store.set(ENABLED_KEY, true)
  await $.ui.open({ id: PANE, title: TITLE })
  await recount($, 'summary')
}

async function turnOff($: EngineInterface): Promise<void> {
  await $.store.set(ENABLED_KEY, false)
  await $.ui.close({ id: PANE })
  $.ui.status(undefined)
}

/** The count a turn, a compaction or a new session asks for: none while turned off. */
async function autoRecount($: EngineInterface): Promise<void> {
  if (await isEnabled($)) await recount($, 'summary')
}

// ── Counting ────────────────────────────────────────────────────────────────

async function recount($: EngineInterface, detail: ContextBreakdownDetail): Promise<void> {
  if (isRunning) return
  isRunning = true
  try {
    await update($, isCounting, () => true)
    const { context } = await $.session.usage({ breakdown: detail })
    if (!context.breakdown) return
    const snap = toSnapshot(context.breakdown, detail, await $.clock.now())
    await update($, snapshot, () => snap)
    // Turned off while the count ran: the status line stays clear.
    if (await isEnabled($)) $.ui.status(statusLine(snap))
  } catch (error) {
    $.ui.log(`${PLUGIN}: counting the context failed: ${String(error)}`, { to: 'debug' })
  } finally {
    isRunning = false
    await update($, isCounting, () => false).catch(() => undefined)
  }
}

// ── Drawing ─────────────────────────────────────────────────────────────────

type Site = Parameters<EngineInterface['ui']['resolve']>[0]

/** The window as one bar: each used category its own colour, the rest free. */
function windowBar($: EngineInterface, site: Site, snap: UsageSnapshot, width: number): RenderElement {
  const { Box, Text } = $.ui.resolve(site)
  const max = Math.max(snap.maxTokens, snap.totalTokens, 1)
  let used = 0
  let drawn = 0
  const segments = snap.categories
    .filter((category) => category.kind === 'used' && category.tokens > 0)
    .map((category) => {
      used += category.tokens
      const end = Math.round((used / max) * width)
      const cells = end - drawn
      drawn = end
      return cells > 0 ? <Text color={category.color}>{'█'.repeat(cells)}</Text> : null
    })
  return (
    <Box flexDirection="row">
      {segments}
      <Text dimColor>{'░'.repeat(Math.max(0, width - drawn))}</Text>
    </Box>
  )
}

function row($: EngineInterface, site: Site, label: string, value: string, color?: string): RenderElement {
  const { Box, Text } = $.ui.resolve(site)
  return (
    <Box flexDirection="row" justifyContent="space-between" gap={1}>
      <Text color={color} wrap="truncate-end">
        {label}
      </Text>
      <Text>{value}</Text>
    </Box>
  )
}

function groupBlock($: EngineInterface, site: Site, usageGroup: UsageGroup): RenderElement {
  const { Box, Text } = $.ui.resolve(site)
  const shown = usageGroup.items.slice(0, TOP_ITEMS)
  const hidden = usageGroup.items.length - shown.length
  const title = usageGroup.note ? `${usageGroup.title} (${usageGroup.note})` : usageGroup.title
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box flexDirection="row" justifyContent="space-between" gap={1}>
        <Text bold>{title}</Text>
        <Text bold>{formatTokens(usageGroup.tokens)}</Text>
      </Box>
      {shown.map((item) =>
        row($, site, `  ${item.label}${item.note ? ` · ${item.note}` : ''}`, formatTokens(item.tokens)),
      )}
      {hidden > 0 && <Text dimColor>{`  +${hidden} more`}</Text>}
    </Box>
  )
}

function snapshotView($: EngineInterface, site: Site, snap: UsageSnapshot, width: number): RenderElement {
  const { Box, Text } = $.ui.resolve(site)
  const compactAt = snap.autoCompactAt ? ` · compacts at ${formatTokens(snap.autoCompactAt)}` : ''
  return (
    <Box flexDirection="column">
      <Text bold>{`${snap.percentage}% · ${formatTokens(snap.totalTokens)} / ${formatTokens(snap.maxTokens)}`}</Text>
      <Text dimColor wrap="truncate-end">{`${snap.model} · ${snap.detail} · ${formatTime(snap.countedAt)}${compactAt}`}</Text>
      {windowBar($, site, snap, width)}
      <Box flexDirection="column" marginTop={1}>
        {snap.categories.map((category) =>
          row(
            $,
            site,
            category.name,
            `${formatTokens(category.tokens)} ${formatPercent(category.tokens, snap.maxTokens)}`.trim(),
            category.kind === 'used' ? category.color : undefined,
          ),
        )}
      </Box>
      {snap.groups.map((usageGroup) => groupBlock($, site, usageGroup))}
    </Box>
  )
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: PLUGIN,
      description: 'Show the context usage pane, or turn it off and on',
      argumentHint: '[on|off]',
    })
    if (await isEnabled($)) void $.ui.open({ id: PANE, title: TITLE })
    const started = await next(e)
    await autoRecount($)
    return started
  })

  on('command.run', { command: PLUGIN }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off') {
      await turnOff($)
      return { text: 'ctx-usage-dock is off. Run /ctx-usage-dock on to turn it on again.' }
    }
    if (arg !== '' && arg !== 'on') return { text: 'Usage: /ctx-usage-dock [on|off]' }
    await turnOn($)
    return { text: 'ctx-usage-dock is on.' }
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await autoRecount($)
    return done
  })

  on('session.compact', async ($, e, next) => {
    const compacted = await next(e)
    if (e.agentId === undefined) await autoRecount($)
    return compacted
  })

  // `/clear`, `/resume` and a fork switch sessions without another `session.start`.
  on('classic.SessionStart', async ($, e, next) => {
    const started = await next(e)
    await autoRecount($)
    return started
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const snap = await read($, snapshot)
    const counting = await read($, isCounting)
    const width = Math.max(10, e.props.bodyColumns)

    return (
      <Box flexDirection="column">
        {snap ? snapshotView($, e, snap, width) : <Text dimColor>No count yet. Press Refresh.</Text>}
        <Box flexDirection="row" gap={1} marginTop={1}>
          <Button label="Refresh" hotkey="r" onPress={() => void recount($, 'summary')} />
          <Button label="Full count" hotkey="f" onPress={() => void recount($, 'full')} />
          <Button label="Turn off" hotkey="o" onPress={() => void turnOff($)} />
          {counting && <Text dimColor>counting...</Text>}
        </Box>
      </Box>
    )
  })
}
