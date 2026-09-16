# Claude Mods — the `$` Cheat Sheet(逐字轉錄)

> 來源:GitHub Issue [`anthropics/claude-code#91870`](https://github.com/anthropics/claude-code/issues/91870)裡,poteat 在 **2026-09-09 Community Update** 附上的 cheat sheet 圖片(標註 *"enumerates some affordances on v267/v268"*)。使用者上傳原圖後,以下是逐區塊的文字轉錄與排版整理。
>
> 圖片右上角資訊:**PRIMITIVE: FUNCTION HOOK · PRODUCT: CLAUDE MOD** / **ANTHROPIC · 2026-09-09**
>
> 副標:*A mod is a plugin with a hooks module. The primitive underneath is the function hook: one async function per event, composed as middleware.*
>
> ⚠️ 這仍然是同一個 preview 功能(見前一份 [`claude-mods-function-hooks.md`](/mnt/user-data/outputs/claude-mods-function-hooks.md))的參考資料,只是這張圖給出更完整、更接近「官方」的 `$` 詞彙表與 event 清單——但仍是 v267/v268 這個特定時間點的快照,not 正式凍結的 API。

---

## 1. THE HOOK

```ts
export function register(on) {
  on("tool.call", { tool: "Bash" }, async ($, e, next) => {
    if (e.command.includes("rm -rf /")) return { deny: "no" }
    const r = await next(e)                    // every hook beneath, then core
    return { ...r, text: redact(r.text) }       // refine on the way up
  })
  .catch(($, e, next) =>                        // it threw or overran
    next.called ? next(e) : { deny: next.error.kind })
}
```

- **`$`** the engine interface; every method on it is itself an event
- **`e`** a flat value; ids are pinned, payload is yours to rewrite

---

## 2. NEXT

| 寫法 | 說明 |
|---|---|
| `next(e)` | every hook beneath you, then core; resolves with the result |
| `return` **without** `next` | answer in core's place: `{ deny }` on `tool.call`, or your own result |
| `next.trace` | after `await`: each lower link's plugin, tier, `e`, result, outcome |
| `next.origin` | `{ plugin, tier }` of the caller; `{ engine, core }` when the engine raised it |
| `next.event` | in a glob or `*` hook: which event this dispatch is |
| `next.is("tool.*", e)` | type predicate: narrows `e`(and 結果)to the matching events |
| `next.to(e, "builtin")` | managed only:contin续在較低的 tier 執行;只會收窄(narrows only) |
| `next(e); next(e)` | zero or more times; each is a fresh dispatch beneath |
| `next.error` · `.called` | in `.catch`: `{ kind, message, budget }`;did you dispatch? `next(e)` replays |

---

## 3. THE CHAIN · 五個層級 · 權限隨層級往 core 遞減

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│ prepend  │  │  user    │  │ append   │  │ builtin  │  │  core    │
│org policy│  │what you  │  │org policy│  │ships in  │  │the engine│
│          │  │  install │  │          │  │  binary  │  │          │
└──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘
```

（圖中有一條由 `builtin` 指回 `prepend` 的虛線箭頭,代表 org 同時掌握鏈的兩端。）

```ts
on("*", ($, e, next) => next.to(e, "builtin"))   // the product as shipped, in one line
```

> One fold for every event: on the way down each link may refine `e`(append is last before the product),core answers by default,on the way up each link may refine the result(prepend is last before the engine acts)。An org holds both ends.

---

## 4. RULES OF THE ROAD

| 條目 | 內容 |
|---|---|
| **spelling** | `$` is always written `$.noun.verb(...)` literally;`on("event")` literally. the loader inventories both and refuses anything it cannot see. |
| **identity** | ids on `e` are pinned(`tool`, `tool_use_id`, `agentId`, `origin`, `provider`, `trigger`, `keys`);the rest is yours to rewrite. |
| **failure** | a throw or a 10s overrun skips the hook with one dim line,unless it declared `.catch`,which runs on a grace budget with the same `next` and answers instead. a wrong-shaped return is always skipped. |
| **recursion** | a hook never sees the dispatches it raised(its `$` calls, its `next`, its spawned agent);its sibling hooks and everyone else do. |
| **trust** | plugins are trusted code with the process's reach. orgs govern by admission: a hook on `plugin.register` sees each plugin's static uses and may refuse it. |
| **classic** | every settings hook is wrapped 1:1 as `classic.<Event>` with its exact JSON in and out;the configured shell hooks are core for that tier. |
| **orgs** | managed machine or Team/Enterprise plan: `sec-default` sits outermost,so a person's plugins cannot touch classic hooks, prompt sections, settings reads or an org-provided tool's description. an org that sets `prependPlugins` owns that tier: it lists `sec-default@builtin` there, or not. |
| **globs** | `on("tool.*")`, `on("classic.*")`, `on("*")`: `e` narrows to the union of the matching events. |
| **agents** | `tool.call` inside a subagent carries `agentId`;`$.agent.list()` maps it to `name`, `parentId`, `type`. Origin(which 是 plugin)與 agent(which 是 loop)是兩條獨立的軸。 |
| **loading** | `plugin.json` + `hooks/hooks.json { "modules": ["./hooks.js"] }`。`claude --plugin-dir ./my-mod` 會在存檔時 hot-reload,而且可以讓 Claude 直接幫你把 mod 寫出來。 |

---

## 5. `$` · NOUNS AND VERBS

> 每個 verb 同時也是一個 event,其他 plugin 都可以 hook 它。

| Noun | Verb(s) | 說明 |
|---|---|---|
| **`$.tool`** | `.call` | run a tool through the hooks and permissions |
| | `.list` | tools the model has now |
| | `.register` | give the model a new tool |
| **`$.command`** | `.run` | run `/command` as if typed |
| | `.list` | slash commands available |
| | `.register` | add `/yourcommand` |
| **`$.prompt`** | `.submit` | queue a prompt as this plugin |
| | `.fill` · `.suggest` | write the prompt box · propose dim text into it |
| **`$.agent`** | `.spawn` | start a subagent, resolves when it settles |
| | `.list` | subagents: id, name, parentId, status |
| **`$.turn`** | `.abort` | cancel the running turn |
| **`$.session`** | `.id` · `.cwd` · `.repo` · `.model` | reads: identity, where, which model |
| | `.surfaces` · `.turns` | reads: the surfaces attached now, turns so far |
| | `.messages` | the transcript, one entry per message |
| | `.usage` | context window fill, rate limits, cost |
| | `.compact` | compact now; goes through `session.compact` like `/compact` |
| | `.authorize` | opaque credential handle, spent by `http.fetch` |
| **`$.model`** | `.complete` | one completion on the session's client |
| | `.fork` | tool-less completion over this transcript, cache-shared |
| | `.classify` | pick one of your labels for a text |
| **`$.ui`** | `.log` · `.notice` | a transcript line · a line under a dialog |
| | `.toast` · `.status` | the notification bar · your status-line slot |
| | `.ask` | the engine's `AskUserQuestion` dialog |
| | `.open` · `.close` | panes |
| | `.invalidate` | re-run a cached event: `ui.render`, `prompt.section`, `tool.describe` |
| | `.resolve` | the element constructors for `e.surface` |
| **`$.fs`** | `.read` · `.write` · `.list` | the host filesystem, with the process's reach |
| | `.stat` · `.exists` | kind/size/mtime · never rejects |
| | `.ancestors` | named instruction files above cwd |
| **`$.settings`** | `.read` | the resolved settings, or one source's layer: `{ source: "policy" }` |
| **`$.config`** | `.set` · `.list` | change a `/config` row through the menu's own door · the rows |
| **`$.env`** | `.get` · `.set` | one variable by LITERAL name; validate lists what you read and write |
| **`$.store`** | `.get` · `.set` · `.delete` · `.keys` | per-plugin persisted JSON |
| **`$.http`** | `.fetch` | through the host; `{ auth }` spends an authorize handle |
| **`$.process`** | `.run` | argv on the host, no shell; stdout/stderr/code |
| **`$.mcp`** | `.call` | a tool on a connected MCP server |
| **`$.clock`** | `.now` · `.sleep` · `.after` · `.every` | time and timers, cancel-able |
| **`$.audio`** | `.play` · `.speak` | a clip; the platform synthesizer |
| **`$.plugin`** | `.name` · `.root` | who you are, where you live |

---

## 6. ENGINE EVENTS · `on("...")`

圖上用 ◆ / ◇ 兩種符號區分:

- **◆ 實心** = core 那一層有副作用:不呼叫 `next` 等於「沒發生」,呼叫兩次 `next` 等於「發生了兩次」
- **◇ 空心** = core 那一層沒有副作用

| | Event | e / 回傳形狀 · 說明 |
|---|---|---|
| ◆ | `tool.call` | `e = { tool, tool_use_id, agentId?, ...input }` → `result` \| `{ deny }` |
| ◇ | ├─ `describe` | what the model is told a tool is · `e.provider`: who ships it |
| ◇ | └─ `check` | the permission decision → `{ decision }` |
| ◆ | `prompt.submit` | the typed prompt; core runs the turn → `{ text, context[] }` |
| ◆ | ├─ `fill` · `suggest` | text written into the box · the dim proposal after a turn; rewrite or refuse |
| ◇ | ├─ `context` | per-turn injected context |
| ◇ | └─ `section` | a system-prompt section |
| ◇ | `turn.start` | `{ turnId, text }` · before the turn |
| ◆ | ├─ `step` | one model request, streamed: `async function*` hook, `yield* next({ ...e, model, effort })` |
| ◇ | └─ `complete` | `{ text }` · usage · after the turn |
| ◇ | `session.start` | `{ cwd, ... }` once per session |
| ◇ | ├─ `receive` | an inbound delivery before it enters context → `{ text }` \| `{ consumed }` |
| ◆ | ├─ `compact` | `{ trigger, instructions?, messages }` → `{ messages }` \| `{ skip }` |
| ◇ | └─ `attach` | and detach: a surface(desktop, phone)joined or left, `{ surface, clientId }` |
| ◆ | `agent.spawn` | `{ prompt, model, provider, parentAgentId?, ... }` → `{ text }` |
| ◇ | └─ `offer` | which agent types the model is offered |
| ◆ | `command.run` | `/name args` → `{ text }` |
| ◇ | └─ `describe` | a command's listing · `e.provider` |
| ◆ | `config.set` | a `/config` row changed: `{ key, value, previous, provider }` → `{ value }` \| `{ deny }` |
| ◇ | └─ `describe` | a row as the menu lists it: relabel or hide |
| ◇ | `ui.render` | `{ surface, component, props }` → element tree |
| ◆ | ├─ `press` · `input` | a Button / Input you drew was used |
| ◆ | ├─ `message` | data posted by your Client surface module |
| ◇ | └─ `resolve` | element table for a surface |
| ◇ | `skill.prompt` | a skill's text as it loads |
| ◇ | `engine.create` | the `$` fold itself: add or withhold nouns |
| ◇ | `plugin.register` | admission: `{ name, tier, uses[] }` → `allow` \| `refuse` |
| ◆ | `classic.*` | exact settings-hook JSON in/out; shell hooks are core |
| ◆ | `*` | every event above,加上每一個 `$` op(`fs.read`, `http.fetch`, `store.set`, ...),都在你所在的層級,擁有一樣的能力:改寫、拒絕、`next.to` |

> **一次 fold**:`e` 往下走,每一層都在細化問題(最內層最後細化);core 給出答案;結果再往上走(最外層最後細化)。

---

## 7. DRAWING · `ui.render`

```tsx
on("ui.render", { component: "ToolUse" }, async ($, e, next) => {
  const { Box, Text, Button } = await $.ui.resolve(e)
  const drawn = await next(e)                    // what beneath drew
  return <Box>
    {drawn}
    <Text dimColor>{e.props.output.length} chars</Text>
    <Button label="copy" onPress={() => $.ui.toast("copied")} />
  </Box>
})
```

| 項目 | 內容 |
|---|---|
| **components** | `UserMessage` · `AssistantMessage` · `ToolUse` · `ToolResult` · `ToolGroup` · `AskUserQuestion` · `Spinner` · `TurnDuration` · `InfoNotice` · `SessionMode` · `PromptHint` · `AbovePrompt` · `Pane` |
| **elements** | `Box` · `Text` · `Button` · `Input` · `Select` · `Link` · `Code` · `Svg` · `Client`——terminal 用 Ink 畫、desktop 用 DOM + Svg、mobile 用較簡化的表格;同一棵樹,由 surface 決定實際的 constructor |
| **pane** | `$.ui.open({ id })` + `on("ui.render", { component: "Pane", requestId: id }, …)` ——你自己開的一個 render site,內容就是你的 hook 畫出來的東西;`$.ui.close({ id })` 結束它 |
| **redraw** | `$.ui.invalidate("ui.render")` ——引擎會重新詢問你所有存在中的畫面,scroll 位置不會跑掉 |
| **hover** | `Box({ key, hover: { borderColor: "cyan" }, children })` ——宣告在元素上、由 surface 套用,沒有事件、不需要往返一趟 |
| **client** | `Client({ module: "./board.js", key, props })` ——跑在 surface 端的 JS,沒有 `$`(只有 state、pointer、keys);只能透過 Button 或 `surface.post` → `ui.message` 回話 |

---

## 8. ORDER IS NESTING · 同一個 fold 的三種畫法

```
X = A ∘ B ∘ C ∘ core = A(B(C(core(⊥))))
```

三張示意圖畫的是同一件事:

1. **從正面看:時序圖(sequence diagram)** —— 依序執行、呼叫 `next(e)`、中空等待、再恢復(*run, call next(e), wait hollow, resume*)
2. **轉個角度:每一根柱子變成一個環** —— 中空的部分就是它底下呼叫的東西(*its hollow middle is the call beneath*)
3. **從上方看:一顆洋蔥,core 在最中心** —— 越早註冊,包住的層越多:**位置就是權限**(*earlier wraps more: position is authority*)

新增一個大家都能用的 noun:

```ts
on("engine.create", async ($, e, next) => ({ ...await next(e), audit: { record } }))
```

---

## 補充說明

- 這張圖給出的是**官方版本的 `$` 詞彙與 event 清單**(v267/v268 時間點),比前一份文件裡「社群從 binary 反推出來的 20 個 event / 36 個 capability」更完整、更權威,但兩者不是同一種列舉方式——這張圖是照 `$.noun.verb` 的樹狀結構列,社群那份是攤平的字串陣列(例如 `PreToolUse` 對應的其實是這裡的 `classic.PreToolUse`,而不是獨立的頂層 event)。兩份資料互相對照看,會比單看任何一份更完整。
- `◆` / `◇` 這組「有無副作用」的標記,直接對應到前一份文件 §10.1 討論的 fail-open/fail-closed 不對稱問題:一個 `◆` event 代表 core 那層真的會做事,`next` 呼叫次數就等於實際發生次數,這也是為什麼「忘記呼叫 next」和「呼叫兩次 next」都會被社群特別拿出來討論。
