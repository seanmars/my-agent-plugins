# code-review-to-html

將 code review 的 markdown 報告轉換為互動式 HTML 檢視器的 skill plugin.

## 包含 Skills

### code-review-to-html

把符合內部 code review 格式 (含 `## P0 — ...`, `### [P0-XX] ...` 等區塊) 的 markdown 報告轉成一個 self-contained 的 HTML 檔, 內建:

- 淺色 / 深色主題切換
- 每個 issue 可獨立展開 / 收合 (預設展開)
- 每個 issue 的一鍵複製 (id + 檔案 + 行數 + 描述 + 程式碼 + 建議)
- 標題列的 checkbox, 狀態透過 `localStorage` 持久化
- 左側 TOC 會自動換行不被截斷

## 使用方式

當使用者要求把 code review 報告 "用 HTML 呈現" / "render 成網頁" / "做成可瀏覽的 checklist" 時, Claude Code 會自動觸發此 skill, 並執行:

```bash
python "<skill-dir>/scripts/convert.py" <input.md> [output.html]
```

- 省略 `output.html` 時, 會輸出在 input 同層, 副檔名換成 `.html`
- 需要 Python 3.8+ (Windows 上是 `python` 而非 `python3`)

產生的 HTML 直接用瀏覽器開啟即可, 不需要 build step 或 server.

## 目錄結構

```
plugins/code-review-to-html/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── code-review-to-html/
│       ├── SKILL.md
│       ├── scripts/
│       │   └── convert.py
│       └── assets/
│           └── template.html
└── README.md
```

要調整外觀或加欄位請直接編輯 `assets/template.html`, 不要改個別輸出檔 (會被下次轉換覆蓋).
