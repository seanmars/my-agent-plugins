# notifier

Claude Code plugin: Windows Toast 通知. Claude 完成回應或需要使用者輸入時自動跳 toast, 讓你不用一直盯著終端機.

## 系統需求

- Windows 10 1903+
- .NET 10 SDK
- Claude Code

## 互動式設定 (推薦)

`setup.cs` 是 dotnet file-based app, 一個工具搞定所有 `CLAUDE_NOTIFY_*` 環境變數與 AUMID 註冊:

```powershell
# 在 plugin 目錄下
dotnet run setup.cs
```

功能:

- 寫入 / 清除 5 個 `CLAUDE_NOTIFY_*` 使用者環境變數 (HKCU\Environment, 不需要管理員權限)
- 設定 `CLAUDE_NOTIFY_APP_ID` 時一併註冊對應 AUMID 到 `HKCU\Software\Classes\AppUserModelId\<AppId>`
- AppId 改變時偵測舊 AUMID 並詢問是否移除
- 獨立的「重新註冊 / 移除 AUMID」「清除全部環境變數」選項
- 即時顯示目前狀態 (環境變數值 + AUMID DisplayName / IconUri)

> 注意: 環境變數寫入後, 需要重啟 Claude Code 或新開終端機才會生效.

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

推薦透過 `setup.cs` 設定; 也可以自行寫到 `HKCU\Environment` 或 shell profile.

| 變數 | 預設值 | 用途 |
|------|--------|------|
| `CLAUDE_NOTIFY_TITLE` | (cwd 名稱) | Toast 標題前綴, 會以 `<title> - <cwd>` 形式顯示 |
| `CLAUDE_NOTIFY_APP_ID` | `ClaudeCode.Notifier` | AUMID, 需先註冊才會顯示對應 DisplayName |
| `CLAUDE_NOTIFY_ICON` | plugin 內 `app.ico` | Toast 大圖示絕對路徑 |
| `CLAUDE_NOTIFY_ICON_CROP` | `square` | `circle` 或 `square` |
| `CLAUDE_NOTIFY_DURATION` | `long` | `short` (~5s) 或 `long` (~25s) |

## 疑難排解

直接呼叫 hook 腳本驗證流程:

```powershell
# 在 plugin 目錄下
$root = (Resolve-Path .).Path
'{"hook_event_name":"Stop"}' | dotnet run $root\hooks\scripts\notify.cs -- --hook $root
```

如果這樣可以跳通知但 Claude Code 觸發時不行, 表示 plugin 沒被載入: 檢查 `/plugin list` 並重啟 Claude Code.

## CLI 模式

`hooks/scripts/notify.cs` 也支援不經 hook 直接呼叫, 適合手動測試:

```powershell
dotnet run hooks\scripts\notify.cs -- --help
dotnet run hooks\scripts\notify.cs -- "Hello" "World" --app-id "ClaudeCode.Notifier"
```
