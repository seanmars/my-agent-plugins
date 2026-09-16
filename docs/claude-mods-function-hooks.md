# Claude Mods(Function Hooks)技術說明文件

> 整理來源:GitHub Issue [`anthropics/claude-code#91870`](https://github.com/anthropics/claude-code/issues/91870)(*Function Hooks - make plugins 10x more powerful*)、以及 Anthropic 內部技術架構文件《Function Hooks: Core Architecture》(Alice Poteat,2026/08)。
>
> ⚠️ **狀態:Preview,尚未正式 ship**。目前掛在 feature flag 後面測試中,API 形狀、預設行為都還在變動,本文件中標示「實測」的內容是社群針對特定版本測出來的行為,不是正式規格,未來可能改變。

---

## 1. 這是什麼

**Function Hooks** 是 Claude Code plugin 系統裡,除了既有的 `command` / `prompt` / `agent` / `http` 四種 hook 之外,新增的第五種型別:讓你直接用 **TypeScript 函式**掛進 Claude Code 的引擎(engine),而不是透過 shell script 或 JSON 溝通。

**Claude Mods** 是產品面(對外使用者)的講法:一個 mod 就是「使用了 function hooks 的 plugin」。兩個詞指同一件事——`function hook` 是底層工程實作術語,`mod` 是產品命名,plugin 本身的概念完全沒變。

### 為什麼要做這個

現行的 shell/command hook 有幾個結構性問題,在討論串裡被反覆提到:

- **穿越 shell 造成的錯誤**:command hook 靠 stdin/stdout 傳 JSON,實際執行時常常要過一層 shell(尤其 Windows 上是 Git Bash / MSYS),造成參數被吃掉、編碼跑掉、`.cmd` shim 抓不到等問題。`$.process.run(argv)` 直接吃參數陣列、完全不經過 shell,被多位使用者認為是這個提案對 Windows 使用者最實際的好處。
- **沒有型別、除錯困難**:每個 command hook 都要自己重新 parse stdin JSON,而且是不透明的黑盒。Function hook 有完整 TypeScript 型別與 LSP 支援。
- **無法在讀取前改寫工具輸出**:`PostToolUse` 只能在結果「已經記錄」之後執行,無法真正攔截、改寫內容(例如在 model 讀到之前先做 redaction)。Function hook 的 `after` / `instead` / `modifying` 幾種 placement 可以做到。
- **無法表達「治理規則」**:很多團隊把重要規則寫在 `CLAUDE.md` 裡當作文字提示,但文字會被忽略、會過時。Function hooks 讓這些規則變成程式碼、可被強制執行,而不是「希望 model 記得」。

---

## 2. 核心詞彙(Vocabulary)

| 術語 | 意義 |
|---|---|
| **plugin** | 安裝、管理、探索的最小單位:一份 manifest,加上它的 skills、agents、MCP servers 與 hooks。 |
| **hooks-module** | plugin 的 `hooks.json` 裡用 `modules` 指到的 `.js` / `.ts` / `.jsx` / `.tsx` 檔案。 |
| **hook** | 註冊在某個 event 上的函式,固定簽名 `($, e, next)`。 |
| **event** | 呼叫 `$` 上某個方法所觸發的行為,例如 `$.tool.call(...)`。Hook 註冊在 event 上;呼叫該方法就會跑對應的 hook chain(不含自身遞迴,見 §7.4)。 |
| **`$`(engine interface)** | 引擎介面:hook 能讀到的狀態、能造成的副作用,是一個「`$.名詞.事件(input)`」形狀的物件。 |

---

## 3. 基本用法:一個 hook 從 shell 版變成 function 版

現行(`command` 型):

```json
{ "hooks": {
    "PreToolUse": [
      { "matcher": "Bash",
        "hooks": [ { "type": "command", "command": "./hooks/block-rm.sh" } ] } ] } }
```

新增(`function` 型):在 `hooks/hooks.json` 裡加一個 `modules` 欄位:

```json
{ "modules": ["./my-hooks.ts"] }
```

在 `hooks/my-hooks.ts` 裡用 `register` 這個 callback 註冊你的 hook:

```ts
export function register(on) {
  on("tool.call", ($, e, next) => {
    if (e.tool === "Bash" && e.command === "rm -rf /")
      return { deny: "Destructive command blocked by hook" }
    return next(e)
  })
}
```

`on` 也接受一個可選的 matcher,對 `e` 做部分比對(物件比對每個 key、陣列比對「任一元素符合」、其他值比對相等):

```ts
on("tool.call", { tool: "Bash" }, ($, e, next) => {
  if (e.command === "rm -rf /") return { deny: "Destructive command blocked by hook" }
  return next(e)
})
```

一個 plugin 只匯出一個 `register(on, options)`,`options` 走既有的 plugin-level `userConfig` 機制設定。

---

## 4. 組合代數(Algebra):Order Is Nesting

這是整個設計最核心的概念:**多個 plugin 對同一個 event 的 hook,组合方式是 middleware/洋蔥模型**(概念上等同 Koa / Express 的 `next()` continuation)。

一個 Claude Code 安裝裡有一串已註冊的 plugin,每個 plugin 又有自己的一串 hook。同一個 event 上依「註冊順序」疊起來:

```
on(X, A), on(X, B), on(X, C)  折疊成  X = A(B(C(⊥)))
```

- **越早註冊、包得越外層、權限越大**:因為它包住了所有後面的東西,可以在呼叫 `next()` 前後、甚至完全不呼叫 `next()` 就決定結果。
- **負責預設行為的 core plugin 通常最後註冊**,所以它反而是權限最小、包在最裡面的那層。
- 這正是**企業管理機制**的基礎:管理者把 plugin prepend 到最前面,就等於把它放在最外層,底下所有 plugin(包含使用者自己裝的)都繞不過它。哪些 plugin 可以存在、`$` 上有哪些 noun,都是掛在 `plugin.register` / `engine.create` 這兩個 event 上的 hook 決定的。

一個實際例子——稽核紀錄,掛在 `*`(所有事件)上,prepend 到最前面即可讓管理者看到每一次呼叫:

```ts
on("*", ($, e, next) => {
  $.ui.log(`${next.origin} called ${next.event} at ${Date.now()}`)
  return next(e)
})
```

---

## 5. 五種 Placement(你的邏輯要放在動作的哪個位置)

「動作發生的那一刻」指的是最後一個註冊的 callback(通常是 core plugin)被呼叫的瞬間。每個 hook 決定自己相對這個時間點要站在哪:

| Placement | 做的事 | 範例(`tool.call`) |
|---|---|---|
| **before** | 先做事,再讓後面的鏈接著跑 | `$.ui.log("about to run " + e.tool); return next(e)` |
| **after** | 先讓動作發生,再用 `await` 拿到結果 | `const result = await next(e); $.ui.log(e.tool+" ran"); return result` |
| **during** | 啟動後面的鏈,同時(不 await)自己做事,兩者並行 | `const pending = next(e); $.ui.log("running "+e.tool); return pending` |
| **instead** | 完全蓋掉底下的一切,不呼叫 `next` | `return { deny: "no tools allowed" }` |
| **modifying** | 把改過的 event 轉發下去 | `return next({ ...e, timeout: 30 })` |

`e`(event)是不可變的純值,要修改必須傳一份改過的複本給 `next`。`next` 除了呼叫本身,還附帶:

- `next.signal` — 一個 `AbortSignal`,整條鏈結束或被中止時觸發,讓 hook 可以清掉自己還在跑的背景工作。
- `next.is(type, e)` — type predicate,可以判斷「這次 dispatch 是不是某個特定 event」,在 `on("*", ...)` 這種萬用 hook 裡特別有用。
- `next.event` / `next.origin` — 目前這個 event 的名字、以及是哪個 plugin 觸發的,方便做 log。

---

## 6. UI 也是事件:Render Events

畫面繪製同樣是可以 hook 的事件——`ui.render`,可以用 matcher 鎖定特定元件:

```ts
on("ui.render", { component: "ToolUse" }, async ($, e, next) => {
  const { Row, Badge } = $.ui.resolve(e)
  const rendered = await next(e)
  return (
    <Row>
      {rendered}
      <Badge text={`${e.props.output.length} chars`} />
    </Row>
  )
})
```

- `e.component` / `e.props` / `e.surface`:分別是哪個元件、它的 render 參數、畫在哪個 surface(`"terminal"` / `"desktop"` / 某個 artifact)。
- 每個 surface 各自定義自己的 **jsx / elements / components** 三元組(這個 surface 的 JSX 編譯目標、可用的基礎標籤、可被 hook 的元件集合),plugin 用 `$.ui.resolve(e)` 拿到當下 surface 對應的元素來畫圖。
- 使用者互動(按鈕按下、輸入等)也走同一套事件模型,例如 `ui.press`,並帶有 `e.plugin` / `e.element` / `e.component` 指出是哪個 plugin 畫的哪個元件。

---

## 7. 引擎介面 `$` 是怎麼組出來的

`$` 是每個 hook 能看到、能動用的一切:讀檔、呼叫 network、呼叫 model、畫面等。它本身**也是**由一串 hook 折疊出來的:

- 引擎在啟動時跑一次 `engine.create` 這條 hook 鏈。它的最底層(`⊥`)回傳空物件;負責加入基礎能力(檔案、網路、model、terminal、權限)的 **core plugin 最後註冊**,每一步都可以在 `next(e)` 回傳的物件上「加」自己的 noun,但不能取代別人已經加的。
- 想改變某個既有方法的行為,要用 hook 那個方法本身,而不是在 `engine.create` 裡覆寫它。

```ts
on("engine.create", async ($, e, next) => {
  const below = await next(e)
  return { ...below, store: createStore(below) }   // 加一個新 noun,不是取代
})
```

- **型別**:`$` 的型別是單一個 TypeScript interface `EngineInterface`,plugin 透過 declaration merging 把自己的 noun 加進去,這樣 `on("cache.evict", ...)` 之類的呼叫才能被正確推導型別:

```ts
declare module "claude-code" {
  interface EngineInterface { cache: Cache }
  interface Cache { evict(input: { key: string }): Promise<void> }
}
```

### 其他規則(§6 Miscellanea)

- **`*` hook**:註冊在 `*` 上等於註冊在所有 event(包含其他 plugin 自己新加的 noun)上,依它在各 event 清單裡的位置各自套用。
- **不會自我遞迴**(§6.4):一個 hook 在自己的 frame 還在執行時不會被重複呼叫——引擎會靜靜跳過它、繼續跑其他已註冊的 hook。這也是後面「provider 無法消費自己的 noun」這個已知限制的根源(見 §9)。

---

## 8. 怎麼開始使用(目前的 preview 流程)

1. **確認 Claude Code 版本**:`modules` 這個 key 從 2.1.250 起就能被解析,但實際的 runtime(執行 function hook 的引擎)要到 **2.1.259** 才存在。社群測試主要落在 2.1.260 ~ 2.1.269 之間。
2. **開啟 flag**:啟動前設定環境變數 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`,或寫進 `~/.claude/settings.json`:
   ```json
   { "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }
   ```
   沒開這個 flag 時,module 會被靜靜跳過(`hooks modules not loaded: rollout flag ... is off`),plugin 照樣裝得起來,但不會有任何效果、也不會報錯。
3. **`/plugin-types`**:flag 開啟後執行,會在你的專案裡產生 `$` 目前可用的完整 TypeScript 型別宣告(`.claude/types/claude-code.d.ts`),讓 `on("...")` 有自動完成。
4. **`claude plugin validate <plugin-dir>`**:離線、不需要 API key 的靜態檢查工具,會列出這個 module 註冊了哪些 event(含 matcher)、呼叫了 `$` 上的哪些方法,錯誤的 event 名稱會被擋下來。
   - ⚠️ 目前只檢查「語法形狀」,不檢查該 `$` 方法**是否真的存在**——呼叫一個不存在的 noun(例如打錯字的 `$.fs.read`,正確應為 `$.fs.readFile`)一樣會驗證通過,但實際執行時會直接 throw(見 §9)。
5. **內建 mods 原始碼可參考**:官方釋出了前三個內建 mod 的原始碼,放在 `github.com/anthropics/claude-code/tree/main/mods`,之後會逐步把現有功能遷移成 mod 形式。
6. **安裝別人做的 mod**:透過既有的 plugin marketplace 機制:
   ```bash
   claude plugin marketplace add <github-repo>
   claude plugin install <mod-name>@<marketplace-name>
   ```

---

## 9. 實測整理:目前(2.1.263 build)量到的 API 清單

以下清單是社群透過讀取二進位檔(`grep` 陣列字面值等方式)量出來、且互相校對過的結果,**不是官方文件**,版本更新後可能整批改變。

<details>
<summary>20 個已註冊的 event</summary>

```
PreToolUse, tool.call, ui.render, ui.resolve, ui.press, ui.input, ui.select,
agent.offer, agent.spawn, prompt.submit, prompt.section, prompt.context,
tool.describe, skill.prompt, attribution.text, session.start, turn.start,
turn.step, turn.complete, engine.create
```
</details>

<details>
<summary>36 個 `$` capability</summary>

```
model.complete, model.classify, model.fork, audio.play, audio.speak, mcp.call,
session.cwd, session.model, session.turnCount, session.id, session.messages,
session.repo, session.surface, session.authorize, turn.abort, flag.value,
tool.list, tool.register, agent.list, ui.toast, ui.status, ui.log, ui.notice,
ui.invalidate, fs.readFile, fs.writeFile, fs.listDir, fs.exists, fs.stat,
fs.ancestors, store.get, store.set, store.delete, store.keys, http.fetch,
process.run
```

（注意:目前確認是 `fs.readFile`,PDF 討論裡提過的 `fs.read` 改名尚未上線。）
</details>

也確認存在一個 **`classic.*`** capability namespace:把既有的 shell/command hook 原封不動包成一個 `$` 能力(例如 `classic.PreToolUse`),讓舊的 hook 可以「不改一行、直接拿到型別」,是社群認為對既有大量 shell hook 使用者最重要的相容性設計。

---

## 10. 已知行為與限制(社群實測,非官方保證)

### 10.1 失敗時的行為不對稱,是目前最大的爭議點

同樣是「hook 沒能正常完成」,不同原因造成的結果方向剛好相反:

| 失敗原因 | 引擎行為 | 方向 |
|---|---|---|
| 載入時發現依賴的 capability 不存在(例如 `classic.*` provider 沒裝) | `unloaded, its withholdings kept while it is declared` | **fail-closed**(擋住) |
| hook 內丟出例外(throw) | `hook failed: ...(event; skipped; what is below it ran in its place)` | **fail-open**(放行) |
| 超過預設 **10,000ms** 的執行預算 | 同上,標註 `exceeded 10000ms budget` | **fail-open** |
| 卡死不 yield(無法回應 heartbeat) | **5,000ms** 內沒回應即判定「wedged」,同上放行 | **fail-open** |

也就是說,**同一個「防護用」的 hook,如果是因為呼叫了不存在的方法而失敗,是放行;但如果是它依賴的能力打從一開始就沒載入,反而是擋住**。多位社群成員(尤其是做治理/合規用途的使用者)因此要求:應該讓每個 hook **自己宣告失敗策略**,而不是讓引擎替它決定方向。目前被提出、討論度最高的方案是三態宣告:

- `deny`(失敗一律視為拒絕)
- `allow`(維持現狀,失敗就放行)
- `allow-and-report`(放行,但明確產生一筆「這個 guard 沒有正常執行」的紀錄,而不是只留在 `--debug-file` 裡)

其他相關的細節發現:

- **忘記呼叫 `next()` 不等於 deny**。回傳一個不是 `{result}` 也不是 `{deny}` 的值(例如 `{}` 或 `undefined`),會被引擎判定為「回傳值不合法」,在 ERROR 等級 log 一行後照樣跳過、底下該跑的動作還是會執行,而且 model 會被告知「成功」。只有明確回傳 `{deny: "原因"}` 才算數。
- **`next()` 之後才 deny,工具其實已經執行過了**。`await next(e)` 之後又回傳 `{deny: ...}`,引擎會記成一次 deny 並把訊息回饋給 model,但實際上動作已經發生、檔案已經寫入——ground truth 與 model 被告知的內容因此不一致。
- **拒絕理由是空字串時,model 可能改用別的工具繞過去**。例如擋下 `Write` 但沒給理由,model 觀察到的行為像是「這個工具壞了」,轉而改用 `Bash` 把同一件事做完——擋一個工具,不等於擋住那個「效果」。
- **連續呼叫兩次 `next()` 會讓同一個工具用同一個 `toolUseId` 重新派送一次**,官方確認這是刻意支援 retry 的設計,但對非幂等(non-idempotent)的工具來說等於執行了兩次。

### 10.2 其他已知限制

- **一個 plugin 無法在自己的 hook 裡呼叫自己新增的 `$` noun**。因為引擎的「不自我遞迴」規則是以整個 plugin 為單位、而不是以單一 hook 為單位,provider 呼叫自己提供的能力會被判定成「re-entry」而跳過,拿到的只是最底層的靜態值——目前唯一的解法是把邏輯在每個需要用到的地方各自內聯複製一份,而不是共用同一份實作。
- **`/plugin-types` 目前只涵蓋 core 與內建工具**,不包含其他已安裝 plugin 自行新增的 noun,所以要「消費」別人加的 `$` 能力,型別上目前只能拿到 `unknown`。
- **`session.repo()` 目前只認得 git**。對 Jujutsu(jj)這類其他版本控制系統、或是 git 的「非 colocate 第二個 working copy」,一律回傳 `null`,即使實際上真的處於一個受版控的目錄裡。有社群成員驗證了一套可行的擴充模式(用一個 hook 攔截 `session.repo` 事件、在 core 回傳 `null` 時自己接手判斷),但目前沒有正式文件承認這是一個擴充點。
- **沒有辦法從 hook 直接觸發 `/compact`**。`$.prompt.submit` 會直接拒絕以 `/` 開頭的文字(host 端的檢查),理由是 `prompt.submit` 被設計成只能送純文字 prompt、不能拿來執行指令。目前只能靠 `$.model.fork()` 額外跑一次共用 prompt cache 的 completion,從它回傳的 `cache_read_input_tokens` 去逼近目前 context 大小——實測誤差在個位數 token 內,但每次檢查都要付一次完整 cache-read 的費用,而且壓縮(compaction)剛發生後的第一次呼叫會拿到 `null`。
- **背景派送的 subagent 工具呼叫,無法從 hook 分辨「已派送」跟「已完成」**。背景派送模式下,工具呼叫在啟動當下就回傳,想要「等它真的做完再蓋章」的用法(例如審核紀錄)目前只能記到「已交辦」,而不是「已完成」。
- **`tool.call` 這類 hook 是否能看到 subagent 內部發出的工具呼叫,目前沒有定論**,官方尚未正面回答,只確認 `on("*", ...)` 能看到每個 plugin 自己對 `$` 的呼叫——但這是不同的軸線,不直接回答「能不能看穿 subagent 邊界」這個問題。

---

## 11. 社群主要訴求(尚未定案)

整理討論串裡出現頻率最高、而且來自不同使用情境(合規治理、DevOps、桌面工具作者、非工程背景使用者)但指向同一件事的訴求:

1. **可宣告的失敗策略**(見 §10.1),取代目前依 event 各自不同、方向甚至互相矛盾的預設行為。
2. **企業/合規使用情境格外看重「結構性、不可繞過」**:多個生產環境使用者(尤其處理 PII、金融合規)明確表示,目前用 prose 寫在 `CLAUDE.md` 裡的規則(例如「未經人工核准不得執行不可逆動作」)是他們最想用 function hooks 取代的部分,因為文字規則會被遺忘或繞過,而 hook 是機制。
3. **`classic.*` 相容層被視為遷移路徑上最關鍵的一塊**——多個維護大量既有 shell hook 的使用者強調,如果能讓舊 hook 不改寫就拿到型別檢查,遷移成本會大幅降低。
4. **可從 CI / 離線環境對單一 hook 跑測試**,不必真的啟動一個互動式 session 才能驗證某個 guard 對「已知會失敗的輸入」是否真的擋得住。

---

## 12. 時間軸

| 日期 | 事件 |
|---|---|
| 2026-09-03 | Anthropic 員工 poteat 在 issue #91870 提出原始提案,附上技術架構 PDF 與示範影片,徵求社群回饋 |
| 2026-09-09 | 官方發布 Community Update:確認會 ship(以週為單位的時程),對外命名為「Claude Mods」,並公開 `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` 讓外部測試 |
| 之後 | 社群持續在 issue 中回報在 2.1.260 ~ 2.1.269 各版本上的實測行為,規格仍在調整 |

---

## 參考來源

- GitHub Issue [`anthropics/claude-code#91870`](https://github.com/anthropics/claude-code/issues/91870) — *Function Hooks - make plugins 10x more powerful*
- 《Function Hooks: Core Architecture》,Alice Poteat,Anthropic,2026 年 8 月(使用者提供之 PDF)
- 內建 mods 原始碼:`github.com/anthropics/claude-code/tree/main/mods`
