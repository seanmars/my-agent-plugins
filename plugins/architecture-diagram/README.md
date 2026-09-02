# architecture-diagram

產生單檔互動式系統架構圖的 skill plugin.

## 包含 Skills

### architecture-diagram

盤點 repo 的實際設定檔後, 輸出一份 self-contained 的 `docs/architecture.html`, 內含:

- 可 hover / click 聚焦的 SVG 拓樸圖 (分層 band + 正交折線的服務連線)
- 服務職責卡片, 每張最後一句是「這裡會咬你」的實作陷阱註記
- 通訊矩陣, 一列一條實際存在的連線
- 關鍵端到端流程, 標出失敗路徑與補償機制

**所有內容都必須來自 repo 的實際檔案**, 查不到就寫 `TBD`. 一份數字精美但錯誤的架構圖比沒有更糟, 因為它會被當成事實引用.

## 使用方式

當使用者要求「系統架構圖」/「服務拓樸圖」/「這個專案的服務怎麼串的」時, Claude Code 會自動觸發此 skill:

1. 從 `compose*.yml` / k8s manifest / `appsettings*.json` / 反向代理設定盤點服務, port 與依賴
2. 複製 `assets/template.html`, 只填資料區的 7 個陣列 (`PROTO` / `KIND` / `BANDS` / `N` / `E` / `CARDS` / `M`)
3. 手寫座標與折點排版, 檢查字數預算 (SVG text 不會換行也不會裁切)
4. 起本機 http server 截圖驗證重疊 / 溢出 / 穿線, 修到乾淨為止
5. 輸出到 `docs/architecture.html`

也可以要求「確認架構圖是否需要更新」, 此時會逐項比對可驗證的事實 (版本號 / port / endpoint), 只改真的過時的部分.

## 目錄結構

```
plugins/architecture-diagram/
├── .claude-plugin/
│   └── plugin.json
├── skills/
│   └── architecture-diagram/
│       ├── SKILL.md
│       └── assets/
│           └── template.html
└── README.md
```

要調整外觀 (配色, CSS, SVG render 行為) 請直接編輯 `assets/template.html`, 不要改個別輸出檔 (會被下次產生覆蓋).
