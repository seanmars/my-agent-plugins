# pet

在輸入框正上方養一隻 ASCII 小寵物,用 `/pet` 呼叫。純裝飾,沒有任何需要照顧的狀態。

> 只支援 Claude Code. 使用 Claude Code 專屬的 function hooks, 安裝到其他 agent 不會運作.

```
                                                        /\_/\
                                                       ( o.o )
                                                        > ^ <
                                                       Mochi
> _
```

## 指令

| 指令 | 作用 |
|---|---|
| `/pet` | 顯示/隱藏 |
| `/pet show` · `/pet hide` | 明確開關 |

顯示與否會存進 plugin 自己的 `$.store`,跨 session 保留.

## 行為

- 每 700ms 一次心跳,每 8 次眨一次眼(約 5 秒).
- Claude 跑 turn 的時候會冒點點.
- 有 survey 佔用 band、或可用高度不足 4 行時自動讓位.

## 設定

`/config` 裡有兩列:

- **Pet name** — 預設 `Mochi`
- **Show on start** — session 啟動時是否直接顯示

## 需求

- Claude Code ≥ 2.1.259
- `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`
- terminal surface(`AbovePrompt` 目前只有 terminal 有)

## 開發

```bash
claude --plugin-dir ./plugins/pet --debug   # 存檔即 hot-reload
claude plugin validate ./plugins/pet
claude plugin test ./plugins/pet
```

型別來自 `/plugin-types` 產生的 `.claude/types/`,更新 Claude Code 後要重跑.
