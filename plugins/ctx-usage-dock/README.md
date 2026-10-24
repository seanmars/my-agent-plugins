# ctx-usage-dock

在 transcript 右側 dock 一個 pane, 依類別顯示 context window 的用量. Status line 也顯示一行摘要.

```
19% · 38.0k / 200.0k
claude-opus-5-5 · summary · 12:05 · compacts at 167.0k
████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
System prompt                  3.0k 1.5%
MCP tools                      5.0k 2.5%
Messages                     30.0k 15.0%
Free space                  162.0k 81.0%

Skills (2/2 listed)                 700
  group-commit · group-commit       500
MCP servers                        5.0k
  linear · 2/3 loaded              5.0k
Memory files                       1.2k
  .claude/CLAUDE.md · User         1.2k
Rules                               400
  rules/style.md · Project          400

[ Refresh ] [ Full count ] [ Turn off ]
```

## 行為

| 項目 | 作用 |
|---|---|
| pane | 和 `/context` 相同的類別, 加上 Skills, MCP servers, Memory files, Rules, Agents, Slash commands 的明細. 每組最多列 8 項 |
| status line | `ctx 19% 38.0k/200.0k │ Messages 30.0k · MCP tools 5.0k · System prompt 3.0k` |
| 自動更新 | session 開始, main loop 每個 turn 結束, compaction 之後, `/clear` 或 `/resume` 之後 |
| `Refresh` (`r`) | 用 `summary` 重新計算 |
| `Full count` (`f`) | 用 `full` 重新計算 |
| `Turn off` (`o`) | 和 `/ctx-usage-dock off` 相同 |
| `/ctx-usage-dock` 或 `/ctx-usage-dock on` | 開啟功能, 開啟 pane 並重新計算 |
| `/ctx-usage-dock off` | 關閉功能: 關閉 pane, 清除 status line, 停止自動計算. 設定存在 `$.store`, 之後的 session 也保持關閉 |

## 運作方式

- 資料取自 `$.session.usage({ breakdown })`, 格式和 SDK 的 `get_context_usage` 相同.
- `summary` 在本地估算, 不呼叫 API. `full` 對每個 tool 和 memory file 呼叫 token-count API, 和 `/context` 相同.
- Rules 是 path 在 `.claude/rules/` 下的 memory file. 其他 memory file 歸在 Memory files.
- MCP servers 的 tokens 只計算已載入的 schema. 按需載入且還沒被搜尋的 schema 不在 window 裡.

## 限制

- Terminal 需要 fullscreen 且至少 110 欄, pane 才會 dock 在右側. 寬度不足時 pane 顯示在 prompt 上方.
- Session 開始時自動開啟 pane 需要至少 144 欄. 寬度不足時, 執行 `/ctx-usage-dock` 開啟.
- `summary` 是估算值, `totalTokens` 不一定等於 API 回報的 input tokens.

## 需求

- Claude Code ≥ 2.1.310
- `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`

## 開發

```bash
claude --plugin-dir ./plugins/ctx-usage-dock --debug   # 存檔即 hot-reload
claude plugin validate ./plugins/ctx-usage-dock
claude plugin test ./plugins/ctx-usage-dock
```
