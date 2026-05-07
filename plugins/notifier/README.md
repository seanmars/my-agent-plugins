# notifier

Claude Code plugin: Windows Toast 通知. Claude 完成回應或需要使用者輸入時自動跳 toast, 讓你不用一直盯著終端機.

## 系統需求

- Windows 10 1903+
- .NET 10 SDK
- Claude Code

## 註冊 AUMID (推薦)

不註冊也能跳通知, 但 toast 標頭會顯示 Windows 內建 Run Dialog 的本地化名稱 (中文系統會看到「執行」). 跑 `install.ps1` 把 AUMID 寫進 `HKCU`, 標頭就會變成 `Claude Code`:

```powershell
# 在 plugin 目錄下
.\install.ps1                          # 預設 AppId=ClaudeCode.Notifier, DisplayName=Claude Code
.\install.ps1 -DisplayName "Claude"    # 自訂顯示名稱
.\install.ps1 -Uninstall               # 移除
```

只寫到 `HKCU\Software\Classes\AppUserModelId\<AppId>`, 不需要管理員權限. plugin 目錄內若放有 `app.ico`, 會一併設成 `IconUri`.

如果想讓程式同時出現在開始功能表 (而不只是登錄檔項目), 改用 repo 根目錄的 `register-shortcut.cs`, 走 Start Menu 捷徑路線.

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

| 變數 | 預設值 | 用途 |
|------|--------|------|
| `CLAUDE_NOTIFY_TITLE` | `Claude Code` | Toast 標題 |
| `CLAUDE_NOTIFY_APP_ID` | `ClaudeCode.Notifier` | AUMID, 需先用 `install.ps1` 註冊才會顯示對應名稱 |
| `CLAUDE_NOTIFY_ICON` | plugin 內 `app.ico` | Toast 大圖示絕對路徑 |
| `CLAUDE_NOTIFY_ICON_CROP` | `square` | `circle` 或 `square` |

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

更多範例與 AUMID 觀念請見 repo 根目錄的 [README](../../README.md).
