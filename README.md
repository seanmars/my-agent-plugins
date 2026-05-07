# os-notify

Windows Toast 通知工具集. 包含:

- **Claude Code plugin** (`plugins/notifier/`) - Claude 完成回應或需要輸入時自動跳 toast. 詳見 [`plugins/notifier/README.md`](plugins/notifier/README.md).
- **獨立 CLI** - .NET 10 file-based app, 單檔 script 免建 project, 可手動或在腳本中發送 toast.

## 系統需求

- Windows 10 1903+
- .NET 10 SDK

## 目錄結構

```
register-shortcut.cs           # 註冊 AUMID 到開始功能表
make-icon.cs                   # 產生範例 app.ico
app.ico                        # 預先生成的範例圖示
plugins/notifier/              # Claude Code plugin (見 plugins/notifier/README.md)
```

---

## 獨立 CLI

`plugins/notifier/hooks/scripts/notify.cs` 同時是 plugin 的 hook 腳本與可獨立呼叫的 CLI. 以下範例假設從 repo 根目錄執行.

### 快速開始

```powershell
$notify = "plugins\notifier\hooks\scripts\notify.cs"

# 最小通知 (沒註冊 AUMID 時, 來源會顯示為 Run Dialog)
dotnet run $notify -- "Hello"

# 帶大圖示, 圓形裁切
dotnet run $notify -- "Build Done" "All tests passed" `
  --icon "$PWD\app.ico" --icon-crop circle

# 指定已註冊的 AUMID
dotnet run $notify -- "Hello" "From me" --app-id "ClaudeCode.Notifier"
```

每個 script 都有 `--help`:

```powershell
dotnet run $notify              -- --help
dotnet run register-shortcut.cs -- --help
dotnet run make-icon.cs         -- --help
```

### 註冊 AUMID: Start Menu 捷徑

`register-shortcut.cs` 走 Start Menu 捷徑路線 (Microsoft 推薦的方式), 程式會出現在開始功能表跟搜尋裡:

```powershell
dotnet run register-shortcut.cs -- `
  --aumid "Sean.OsNotify" `
  --name "OS Notify" `
  --icon "$PWD\app.ico"

# 確認註冊成功
Get-StartApps | Where-Object { $_.AppID -eq "Sean.OsNotify" }

# 之後發通知就指定這個 AUMID
dotnet run $notify -- "Hello" "From OS Notify" --app-id "Sean.OsNotify"

# 移除
dotnet run register-shortcut.cs -- `
  --aumid "Sean.OsNotify" --name "OS Notify" --remove
```

純 plugin 場景請改用 `plugins/notifier/install.ps1` 走登錄檔路線, 較輕量 (但程式不會出現在開始功能表).

### 自訂圖示

```powershell
# 產生一個寫著 "A" 的 ico
dotnet run make-icon.cs -- my-app.ico A
```

---

## 觀念補充

### AUMID 是什麼?

Application User Model ID 是 Windows 用來識別應用程式的字串. Toast 通知必須對應到系統認得的 AUMID 才會出現, 取得方式有三種:

1. **借用系統內建** - 例如 `Microsoft.Windows.Shell.RunDialog`, 直接可發通知, 但標頭會是該 app 的本地化名稱
2. **查現有 App** - `Get-StartApps` 列出已安裝程式的 AUMID
3. **自己註冊** - 本專案提供兩條路:
   - `plugins/notifier/install.ps1` - 純登錄檔, 最輕量
   - `register-shortcut.cs` - Start Menu 捷徑, 同時讓程式可被搜尋啟動

### Toast 上的三個圖示槽位

| 顯示位置 | 來源 |
|---------|------|
| 右上角 App 名稱旁的小圖示 | AUMID 註冊時帶的 `IconUri` 或捷徑 `IconLocation` |
| 通知左側大圖 | toast XML `<image placement="appLogoOverride">` (`notify.cs --icon`) |
| 通知頂部橫幅 | toast XML `<image placement="hero">` (本專案未實作) |

### 注意事項

- 圖示路徑必須是絕對路徑, 而且檔案要持續存在, 否則圖示會變空白方框
- 第一次註冊 AUMID 後可能要重啟 explorer 才會讓通知中心顯示更新後的 App 名稱:
  ```powershell
  Stop-Process -Name explorer -Force; Start-Process explorer
  ```
- file-based app 第一次 `dotnet run` 需要編譯 (數秒), 之後會用 `%TEMP%\dotnet\runfile-build-cache` 的快取
