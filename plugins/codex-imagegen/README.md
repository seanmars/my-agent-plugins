# codex-imagegen

透過 Codex CLI 內建的 `$imagegen` (gpt-image-2) 產生圖片的 skill plugin.

## 包含 Skills

### codex-imagegen

用 headless 模式的 `codex exec` 呼叫 `$imagegen`, 把產生的圖片存進目前專案.

- 適用: 圖片, icon, logo, 插圖, mockup 等 bitmap 素材.
- 不適用: 可以寫成程式碼的圖表 (SVG, Mermaid, HTML), 或只編輯既有圖片.

## 前置需求

- 支援 Windows (PowerShell) 和 macOS (bash/zsh).
- 已安裝 [Codex CLI](https://github.com/openai/codex) 並登入 ChatGPT 帳號.
- 產圖會用掉 ChatGPT 方案的 Codex 額度.

## 使用方式

當使用者要求「產生圖片」/「畫一張」/「做一個 icon」時, Claude Code 會自動觸發此 skill. 也可以直接呼叫:

```
/codex-imagegen 圖片描述 [輸出路徑]
```

沒指定輸出路徑時, 預設存到 `./images/<簡短英文檔名>.png`.

## 目錄結構

```
plugins/codex-imagegen/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── codex-imagegen/
│       └── SKILL.md
└── README.md
```
