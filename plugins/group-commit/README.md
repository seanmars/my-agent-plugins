# group-commit

將所有未 commit 的變更依功能 (issue) 拆成多個 atomic commit 的 skill plugin.

## 包含 Skills

### group-commit

- **以變更為單位, 不是以檔案為單位**: 同一個檔案若同時含有 issue1/2/3 的修改, 會拆到 hunk 甚至單行, 每個 commit 只包含屬於該 issue 的區塊
- **依相依關係排序**: 分析每個變更提供/使用/移除的 symbol, 做 topological sort, 確保先 commit 的內容不依賴後 commit 的內容; 遇到循環相依先嘗試抽出共用基礎 commit, 不行才合併
- **只動 index, 不動 working tree**: 過程可隨時用 `git reset --soft $BASE && git reset -q` 還原
- **commit 後驗證**: 確認沒有遺漏變更, 並對每個中間 commit 做 symbol 靜態檢查, 可行時在臨時 worktree 跑 build/typecheck
- 執行前一定先列出 commit 計畫 (標示 partial 檔案包含哪些區塊), 透過 `AskUserQuestion` 讓使用者確認
- 不使用 `git add .` / `-A`, 不 amend, 不 push, 不 `--no-verify`

## 使用方式

當使用者說「幫我 commit」/「拆 commit」/「依 issue 分組 commit」或輸入 `/group-commit` 時自動觸發. 可以直接告訴它有哪些 issue, 會以此作為分組依據.

需要 Node.js 16+ (只用內建模組, 不需 npm install).

## 目錄結構

```
plugins/group-commit/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── group-commit/
│       ├── SKILL.md
│       ├── scripts/
│       │   └── hunks.mjs     # 列出 hunk 並依 ID / 行號 stage 到 index
│       └── evals/
│           └── evals.json
└── README.md
```
