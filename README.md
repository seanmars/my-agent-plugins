# my-agent-plugins

個人的 coding agent plugin / skill 集合.

## Plugins

| 名稱 | 類型 | 說明 |
|---|---|---|
| [andrej-karpathy-skills](plugins/andrej-karpathy-skills/) | skill | 減少 LLM 常見 coding 錯誤的行為準則 (Andrej Karpathy) |
| [architecture-diagram](plugins/architecture-diagram/) | skill | 產生單檔互動式 HTML 系統架構圖 |
| [code-review-helper](plugins/code-review-helper/) | skill | 產生互動式 HTML code review 報告 |
| [code-review-to-html](plugins/code-review-to-html/) | skill | 把 code review markdown 報告轉成互動式 HTML |
| [group-commit](plugins/group-commit/) | skill | 把未 commit 的變更依 issue 拆成 atomic commits |
| [notifier](plugins/notifier/) | hooks | Claude 完成回應或需要輸入時跳原生通知 (Windows / macOS) |
| [pet](plugins/pet/) | hooks | 在輸入框上方養一隻 ASCII 小寵物 |

## 安裝

### Skill

使用 [skills](https://github.com/vercel-labs/skills) CLI, 支援 Claude Code, Codex, Cursor 等多種 agent:

```bash
# 列出可安裝的 skill
npx skills add seanmars/my-agent-plugins --list

# 互動式選擇要安裝的 skill 與 agent
npx skills add seanmars/my-agent-plugins

# 安裝指定 skill 到全域
npx skills add seanmars/my-agent-plugins --skill group-commit -g
```

### Hooks

hooks 類 plugin (`notifier`, `pet`) 只支援 Claude Code, 需透過 marketplace 安裝:

```bash
claude plugin marketplace add seanmars/my-agent-plugins
claude plugin install notifier@my-agent-plugins
claude plugin install pet@my-agent-plugins
```

## 目錄結構

```
plugins/                  # 各 plugin, 每個都有自己的 README
scripts/                  # generate-marketplace.ts
marketplace-template/     # marketplace manifest 樣板
.claude-plugin/           # 產生的 Claude Code marketplace.json
.github/                  # 產生的 Copilot marketplace.json
docs/                     # Claude mods 相關筆記
utils/                    # 零散的工具 script
proxy.mjs                 # 記錄 Claude Code 送給 model 內容的 logging proxy
```

## 開發

新增或修改 plugin 後, 重新產生 marketplace manifest:

```bash
pnpm install
pnpm build
```
