# code-review-helper

產生互動式、self-contained HTML code review 報告的 skill plugin.

## 包含 Skills

### code-review-helper

把一組程式碼變更 (branch / PR / commit / diff) 分析後輸出成單一 HTML 檔, 以 pipeline 方式帶讀者理解: 改了什麼, 為什麼改, 端到端影響, 以及風險. 內建:

- 淺色 / 深色主題切換
- GitHub / GitLab 風格的 PR diff 檢視
- pipeline 流程解說與風險清單 (依嚴重度排序)
- 點選行號可對某段程式碼加註記, 透過 `localStorage` 持久化
- 匯出 Markdown 時會帶上檔案路徑, 行號範圍與原始程式碼

分析正確性優先於視覺, 報告只做 review, 不會改動任何 source code.

## 使用方式

當使用者要求 review 一段程式碼 / branch / PR / diff, 或想要 "code review 報告" / "review 走查" / 理解一組變更的影響時, Claude Code 會自動觸發此 skill:

1. 決定 review 範圍 (依使用者描述, 或從 git 狀態推斷後確認)
2. 取得 diff 並對照實際程式碼驗證
3. 分析並分組成獨立的 "stories"
4. 以 `assets/template.html` 為底產生 HTML
5. 預設輸出到 repo 根目錄的 `code-review/index.html`

## 目錄結構

```
plugins/code-review-helper/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── code-review-helper/
│       ├── SKILL.md
│       └── assets/
│           └── template.html
└── README.md
```

要調整外觀請直接編輯 `assets/template.html`, 不要改個別輸出檔 (會被下次產生覆蓋).
