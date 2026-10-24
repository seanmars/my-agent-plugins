/** How a count was made: `summary` estimates locally, `full` asks the token-count API. */
export type CountDetail = 'summary' | 'full'

/** What a /context row is: content in the window, free space, the compaction buffer, or on-demand tool schemas. */
export type CategoryKind = 'used' | 'free' | 'buffer' | 'deferred'

/** One line under a group: a skill, an MCP server, a memory file. */
export type UsageItem = {
  label: string
  tokens: number
  /** What follows the tokens: `3/20 loaded`. */
  note?: string
}

/** A list /context prints beneath its grid: Skills, MCP tools, Memory files, Rules, Agents. */
export type UsageGroup = {
  title: string
  tokens: number
  /** What follows the title: `40/45 listed`. */
  note?: string
  items: UsageItem[]
}

/** One row /context prints beside its grid. */
export type UsageCategory = {
  name: string
  tokens: number
  /** The theme key /context draws the row in. */
  color: string
  kind: CategoryKind
}

/** The context window as the last count broke it down. */
export type UsageSnapshot = {
  detail: CountDetail
  /** When the count finished, in epoch milliseconds. */
  countedAt: number
  model: string
  totalTokens: number
  maxTokens: number
  percentage: number
  autoCompactAt?: number
  categories: UsageCategory[]
  groups: UsageGroup[]
}

declare module 'claude-code' {
  interface PluginState {
    'ctx-usage-dock': {
      /** The last count; null before the first one lands. */
      snapshot: Shaped<UsageSnapshot | null>
      /** True while a count runs. */
      isCounting: boolean
    }
  }
}
