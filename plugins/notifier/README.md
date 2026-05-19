# notifier

Claude Code plugin: 跨平台原生通知 (Windows Toast / macOS Notification Center). Claude 完成回應或需要使用者輸入時自動跳通知, 讓你不用一直盯著終端機.

## 系統需求

通用:

- [uv](https://docs.astral.sh/uv/) (用來執行 PEP 723 inline-metadata 的 Python 腳本, 第一次跑會自動裝相依 / 拉合適的 Python)
- Claude Code

Windows:

- Windows 10 1903+
- 直接使用內建 PowerShell + WinRT, 無額外依賴 (Python stdlib 的 `winreg` + `ctypes` 處理註冊表與廣播)

macOS:

- macOS 11+ (理論上更舊版也可, 但未測試)
- (選用, 推薦) `brew install terminal-notifier` - 偵測到就會自動使用, 可拿到 icon dedupe / `-group` 取代行為; 沒裝就 fallback 到 `osascript`
- 走 `osascript` fallback 時, 第一次跳通知需要在 **系統設定 > 通知** 給 **Script Editor** 通知權限 (系統會以 Script Editor 的身份送出). 使用 terminal-notifier 則改為授權 terminal-notifier 自己

> 沒裝 uv 也可以直接用 `python` 跑 (notify.py 只用 stdlib), 但 hooks.json 預設是 `uv run`. 想換成 `python` 就把 hooks.json 裡的 `uv run` 改成 `python` 即可.

## 平台差異

| 功能 | Windows | macOS (terminal-notifier) | macOS (osascript fallback) |
|------|---------|----------|----------|
| Title / Body | OK | OK | OK |
| `CLAUDE_NOTIFY_TITLE` 前綴 | OK | OK | OK |
| 自訂 icon (`--icon`) | OK | best-effort, 限 PNG/JPG (`.ico` 自動跳過); 現代 macOS 對 sender icon 有限制 | 不支援 (一律顯示 Script Editor 圖示) |
| Icon crop (`--icon-crop`) | OK | 不支援 | 不支援 |
| App ID / 重複通知合併 | OK (AUMID) | OK (`-group` 用 `--app-id` 當鍵, 新通知會取代舊的) | 不支援 |
| Duration (`--duration`) | OK | 不支援 | 不支援 |

macOS 上不支援的選項會被靜默忽略, 不會報錯.

## 互動式設定 (Windows 限定)

`setup.py` 一個工具搞定所有 `CLAUDE_NOTIFY_*` 環境變數與 AUMID 註冊:

```powershell
# 在 plugin 目錄下
uv run setup.py
```

功能:

- 寫入 / 清除 5 個 `CLAUDE_NOTIFY_*` 使用者環境變數 (HKCU\Environment, 不需要管理員權限)
- 設定 `CLAUDE_NOTIFY_APP_ID` 時一併註冊對應 AUMID 到 `HKCU\Software\Classes\AppUserModelId\<AppId>`
- AppId 改變時偵測舊 AUMID 並詢問是否移除
- 獨立的「重新註冊 / 移除 AUMID」「清除全部環境變數」選項
- 即時顯示目前狀態 (環境變數值 + AUMID DisplayName / IconUri)
- 寫完環境變數自動廣播 `WM_SETTINGCHANGE`, 新開的終端機馬上看得到

> 注意: 環境變數寫入後, 需要重啟 Claude Code 或新開終端機才會生效.

> macOS 使用者請改在 shell profile (例如 `~/.zshrc`) 直接 `export CLAUDE_NOTIFY_TITLE=...`. setup.py 只動 Windows registry, 在 macOS 上會直接結束.

## 監聽的 hook 事件

| 事件 | 通知內容 |
|------|---------|
| `Stop` | `Awaiting your input` |
| `Notification` | 依 `notification_type` 變化: `Awaiting your input` / `Input requested` / `Authenticated` 等 |
| `PermissionRequest` | `Permission required: <tool>` |
| `PreToolUse` (僅 `AskUserQuestion`, `ExitPlanMode`) | `Question: ...` 或 `Plan ready - approval needed` |
| `SessionEnd` | `Session ended (<reason>)` |

Title 會自動加上目前工作目錄名稱, 例如 `Claude Code - my-project`.

## 客製化 (環境變數, 全部選用)

Windows: 推薦透過 `setup.py` 設定; 也可以自行寫到 `HKCU\Environment`.
macOS: 寫到 shell profile (`~/.zshrc` / `~/.bashrc`) 即可.

| 變數 | 預設值 | 用途 | 平台 |
|------|--------|------|------|
| `CLAUDE_NOTIFY_TITLE` | (cwd 名稱) | Toast 標題前綴, 會以 `<title> - <cwd>` 形式顯示 | Win + macOS |
| `CLAUDE_NOTIFY_APP_ID` | `ClaudeCode.Notifier` | Windows: AUMID DisplayName 來源; macOS (terminal-notifier): `-group` 鍵, 同 group 的新通知會取代舊的 | Win + macOS (僅 terminal-notifier) |
| `CLAUDE_NOTIFY_ICON` | plugin 內 `app.ico` | Toast 大圖示絕對路徑. macOS 需要 PNG / JPG (`.ico` 會被跳過); 透過 terminal-notifier `-appIcon` 嘗試覆寫 | Win + macOS (僅 terminal-notifier, best-effort) |
| `CLAUDE_NOTIFY_ICON_CROP` | `square` | `circle` 或 `square` | Windows |
| `CLAUDE_NOTIFY_DURATION` | `long` | `short` (~5s) 或 `long` (~25s) | Windows |

## 產生預設 icon

repo 不附 `app.ico`, 想要 toast 帶圖示就先產一份:

```powershell
# 在 plugin 目錄下 (Windows)
uv run make-icon.py app.ico P
```

```bash
# macOS / Linux
uv run make-icon.py app.ico P
```

第二個參數是要畫在 icon 上的字母 (預設 `P`), 第一個是輸出檔. make-icon.py 用 Pillow 畫 45 度漸層圓底 + 白色置中字母, 一次輸出 16/32/48/64/128/256 多尺寸 ico.

## 疑難排解

直接呼叫 hook 腳本驗證流程.

Windows (PowerShell):

```powershell
# 在 plugin 目錄下
$root = (Resolve-Path .).Path
'{"hook_event_name":"Stop"}' | uv run "$root\hooks\scripts\notify.py" --hook "$root"
```

macOS (zsh/bash):

```bash
# 在 plugin 目錄下
root="$(pwd)"
echo '{"hook_event_name":"Stop"}' | uv run "$root/hooks/scripts/notify.py" --hook "$root"
```

如果這樣可以跳通知但 Claude Code 觸發時不行, 表示 plugin 沒被載入: 檢查 `/plugin list` 並重啟 Claude Code.

macOS 完全沒看到通知?

- 沒裝 terminal-notifier: 到 **系統設定 > 通知 > Script Editor** 確認通知權限已開啟. 第一次跑時系統可能根本沒提示授權, 只是靜默丟棄.
- 有裝 terminal-notifier: 改到 **系統設定 > 通知 > terminal-notifier** 確認權限. 想知道現在走哪條路就 `which terminal-notifier`, 有輸出就是走 terminal-notifier.

## CLI 模式

`hooks/scripts/notify.py` 也支援不經 hook 直接呼叫, 適合手動測試:

```powershell
# Windows
uv run hooks\scripts\notify.py --help
uv run hooks\scripts\notify.py "Hello" "World" --app-id "ClaudeCode.Notifier"
```

```bash
# macOS
uv run hooks/scripts/notify.py --help
uv run hooks/scripts/notify.py "Hello" "World"
```
