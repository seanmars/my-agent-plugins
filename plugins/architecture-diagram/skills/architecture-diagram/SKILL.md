---
name: architecture-diagram
description: Generate a single-file interactive HTML system architecture diagram for a repository — hover/click-to-focus SVG topology, service responsibility cards, a communication matrix, and key end-to-end flows. Use when the user asks for a system architecture diagram, service topology map, or a visual overview of how the services in a project fit together.
---

# Architecture Diagram

產生一份自給自足的互動式架構圖 `docs/architecture.html`: 可 hover / click 聚焦的 SVG 拓樸圖 + 服務職責卡片 + 通訊矩陣 + 關鍵流程。

**核心原則: 內容全部來自 repo 的實際檔案, 不臆測。** 一份數字精美但錯誤的架構圖比沒有更糟 —— 它會被當成事實引用。

## 骨架

`assets/template.html` (相對本 SKILL.md 所在目錄) 已經備好完整的 CSS、SVG render code 與互動行為。**把它複製到輸出位置後只填資料區的 7 個陣列, 不要重寫 render code, 也不要就地編輯 plugin 內的 template。**

```
PROTO   通訊協定 -> 顏色 + 圖例名
KIND    元件類型 -> 顏色 + 圖例名
BANDS   水平分層 (客戶端 / 邊緣 / 應用 / 訊息 / 資料)
N       節點 (座標與尺寸手寫)
E       邊 (正交折線的折點手寫)
CARDS   服務職責卡片
M       通訊矩陣列
```

改圖 = 改資料。render code 會自動產生圖例、箭頭 marker、圓角路徑、卡片與表格。

## 流程

### 1. 盤點 (禁止臆測)

先讀 repo 取得事實, 每個數字都要有出處:

| 要查的東西 | 去哪裡查 |
|---|---|
| 服務清單 · 映像版本 | `compose*.yml` / k8s manifest / Aspire AppHost / `Procfile` |
| port · 對外路徑 · 依賴目標 | 各服務的 `appsettings*.json` / `.env.example` / 設定檔 |
| API 表面 (數量 · 關鍵路徑) | controller / route / handler 目錄 |
| 反向代理與 domain 切分 | nginx / traefik / ingress 設定 |
| 設計決策與已知陷阱 | `README` / `AGENTS.md` / `CLAUDE.md` / `docs/` 下的 ADR |

- 查不到就寫 `TBD`, 不要推測版本號或 port
- 完成後在回覆中列出查證過的項目與出處, 讓使用者可以抽查

專案很大時先與使用者確認邊界 (例如「只涵蓋 runtime 服務與其相依, 不畫 CI/CD 與開發工具鏈」), 否則節點會多到版面塞不下。

### 2. 填資料

依 `assets/template.html` 資料區的欄位註解填寫。分層順序由上而下: 客戶端 / 外部 → 邊緣 → 前端 · 認證 → 應用服務 → 訊息 · 快取 → 資料儲存。

外部系統 (不由本專案部署的 SaaS、GPU 主機、鏈上服務) 用 `dash:1` 畫虛線框。

### 3. 版面 (最容易出錯)

沒有 auto-layout, 座標與折點都是手寫的。第一次產出幾乎必定有重疊, 所以第 6 步的驗證迴圈不可跳過。

- 同一 band 內的節點 `y` 與 `h` 一致; `x` 對齊網格 (例如 320 的倍數), 節點間距至少 30px
- `BANDS` 的 `y`/`h` 要完整涵蓋該層節點
- 邊一律正交折線, 在 `pts` 明確給出每個折點; 起訖點落在節點**框線上**而非框內
- 跨越多層的長距離邊走外圈, 版面右側與下方各預留 40-60px 走線廊道
- 同一對節點有多條邊時, 起點錯開 10-20px
- viewBox 預設 `0 0 1810 1090`; 節點超出就等比放大 viewBox, 不要壓縮節點

### 4. 字數預算 (硬性限制)

SVG `<text>` **不會自動換行也不會裁切**, 文字過長會直接溢出框線。

```
可用寬度 = 節點 w - 24
14px 字級 (副標 / 要點): 中文約 14px/字, 英數約 8px/字
19px 字級 (標題):        中文約 19px/字, 英數約 11px/字
```

超過就縮短文案, **不要**加大節點 —— 那會連帶推擠整個 band 的座標。

### 5. 內容原則 (決定這份文件有沒有用)

- **每張卡片的說明最後一句必須是「這裡會咬你」的註記** —— 從 repo 實際的設計決策或踩過的坑萃取。例如: 某個 header 不可改寫否則簽章失效、health check 必須打哪個 port、前端某個屬性絕對不能加、某個設定在所有 replica 必須同值。不要寫「負責處理 business logic」這種從服務名就看得出來的廢話
- 流程用編號步驟, 明確標出**失敗路徑與補償機制** (退款 / 重試 / 逾時 / 降級)
- 通訊矩陣一列一條**實際存在**的連線; 用途欄寫「為什麼有這條線」, 不是重複協定名

### 6. 驗證 (必做)

1. 抽出 inline script 存成暫存 `.js`, 跑 `node --check` 確認語法 (編輯多在字串字面值內, 未跳脫的引號很容易漏)
2. 起本機 http server 載入截圖 —— **`file://` 常被瀏覽器擴充套件擋掉**, 直接用 http
3. 逐項檢查截圖:
   - 節點是否互相重疊
   - 文字是否溢出框線
   - 邊是否穿過不相干的節點
   - 箭頭是否確實指到目標框
   - 圖例顏色是否與圖上一致
4. 有問題調整座標後**重新截圖**, 直到乾淨為止
5. 清掉所有臨時檔 (截圖、http server、抽出的 js)

已知的**假警報**, 不要追:
- `favicon.ico` 404 —— http server 沒有 favicon, 與頁面無關
- fullPage 截圖下方出現白底 —— `background-attachment:fixed` 的截圖拼接產物,
  實際瀏覽是正常的 (template 已用 `html{background:var(--bg)}` 擋掉)

在同一個障礙上不要重試超過 2-3 次 —— 換一條路 (換瀏覽器工具 / 改用純計算檢查) 或回報使用者。

## 輸出後

建議使用者在專案的 `AGENTS.md` / `CLAUDE.md` 加一行維護提醒:

> 動服務組合 (新增 / 移除服務, 改對外 port 或 domain) 時同步檢查 `docs/architecture.html`

沒有這行, 這份文件三個月後就會變成一份精美的錯誤資訊。

## 更新既有的圖

被要求「確認架構圖是否需要更新」時:

1. 先**逐項比對可驗證的事實** (版本號 / port / 數量 / endpoint 路徑 / TTL), 列出比對結果
2. 只改真的過時的部分, 不要順手重寫
3. 改動節點文案時重新算字數預算
4. 一樣要跑第 6 步的驗證
