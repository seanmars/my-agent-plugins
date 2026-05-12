#:property TargetFramework=net10.0-windows10.0.19041.0

using System.Runtime.CompilerServices;
using Microsoft.Win32;

// Interactive setup tool for the notifier plugin.
// - Persists CLAUDE_NOTIFY_* environment variables to HKCU\Environment so that
//   future Claude Code sessions inherit them.
// - When CLAUDE_NOTIFY_APP_ID changes, also writes the matching AUMID record to
//   HKCU\Software\Classes\AppUserModelId\<AppId> (same job as install.ps1) so
//   Windows shows the desired DisplayName on the toast header.

const string DefaultAppId = "ClaudeCode.Notifier";
const string DefaultDisplayName = "Claude Code";
const string AumidKeyRoot = @"Software\Classes\AppUserModelId";

string scriptPath = GetScriptPath();
string scriptDir = !string.IsNullOrEmpty(scriptPath) && Directory.Exists(Path.GetDirectoryName(scriptPath))
    ? Path.GetDirectoryName(scriptPath)!
    : Directory.GetCurrentDirectory();
string defaultIconPath = Path.Combine(scriptDir, "app.ico");

// Sanity check: setup.cs ships next to install.ps1 inside the plugin dir.
// If install.ps1 is missing, the user is likely running a stray copy and
// app.ico path resolution will be wrong.
if (!File.Exists(Path.Combine(scriptDir, "install.ps1")))
{
    Console.WriteLine($"警告: 在 {scriptDir} 找不到 install.ps1, 預設 icon 路徑可能錯誤.");
    Console.WriteLine();
}

while (true)
{
    SafeClear();
    WriteHeader("Claude Code Notifier - 設定工具");
    PrintAumidStatus();

    Console.WriteLine();
    Console.WriteLine("操作:");
    PrintEnvOption("1", "CLAUDE_NOTIFY_TITLE", "(顯示 cwd 名稱)");
    PrintEnvOption("2", "CLAUDE_NOTIFY_APP_ID", DefaultAppId, suffix: " (一併註冊 AUMID)");
    PrintEnvOption("3", "CLAUDE_NOTIFY_ICON", defaultIconPath);
    PrintEnvOption("4", "CLAUDE_NOTIFY_ICON_CROP", "square");
    PrintEnvOption("5", "CLAUDE_NOTIFY_DURATION", "long");
    Console.WriteLine("  6) 重新註冊 AUMID (使用目前的 APP_ID)");
    Console.WriteLine("  7) 移除 AUMID 註冊");
    Console.WriteLine("  8) 清除全部 CLAUDE_NOTIFY_* 環境變數");
    Console.WriteLine("  q) 離開");
    Console.Write("\n選擇: ");

    string? choice = Console.ReadLine()?.Trim().ToLowerInvariant();
    if (string.IsNullOrEmpty(choice)) continue;

    switch (choice)
    {
        case "1":
            PromptAndSetEnv(
                "CLAUDE_NOTIFY_TITLE",
                "Toast 標題前綴, 會以 \"<title> - <cwd>\" 形式顯示. 留空表示清除.",
                validator: null);
            break;
        case "2":
            ConfigureAppId();
            break;
        case "3":
            PromptAndSetEnv(
                "CLAUDE_NOTIFY_ICON",
                "Icon 檔案絕對路徑. 留空表示清除 (改用 plugin 內 app.ico).",
                validator: v => string.IsNullOrEmpty(v) || File.Exists(v)
                    ? null
                    : "找不到該檔案, 請確認絕對路徑.");
            break;
        case "4":
            PromptAndSetEnv(
                "CLAUDE_NOTIFY_ICON_CROP",
                "Icon 裁切方式: 'square' 或 'circle'. 留空表示清除 (預設 square).",
                validator: v => string.IsNullOrEmpty(v) || v is "square" or "circle"
                    ? null
                    : "只接受 'square' 或 'circle'.");
            break;
        case "5":
            PromptAndSetEnv(
                "CLAUDE_NOTIFY_DURATION",
                "Toast 持續時間: 'short' (~5s) 或 'long' (~25s). 留空表示清除 (預設 long).",
                validator: v => string.IsNullOrEmpty(v) || v is "short" or "long"
                    ? null
                    : "只接受 'short' 或 'long'.");
            break;
        case "6":
            ReregisterCurrentAppId();
            break;
        case "7":
            UnregisterPrompt();
            break;
        case "8":
            ClearAllPrompt();
            break;
        case "q":
        case "exit":
        case "quit":
            return 0;
        default:
            Console.WriteLine($"未知選項: {choice}");
            Pause();
            break;
    }
}

// ===== Local helpers =====

static string GetScriptPath([CallerFilePath] string path = "") => path;

static void SafeClear()
{
    // Console.Clear throws IOException when stdin/stdout aren't a real console
    // (e.g. when piped from a launcher). Fall back to whitespace separation.
    try { Console.Clear(); }
    catch { Console.WriteLine(new string('\n', 2)); }
}

static void WriteHeader(string title)
{
    var line = new string('=', Math.Max(title.Length, 32));
    Console.WriteLine(line);
    Console.WriteLine(title);
    Console.WriteLine(line);
}

void PrintAumidStatus()
{
    string? appId = ReadUserEnv("CLAUDE_NOTIFY_APP_ID");
    string effectiveAppId = string.IsNullOrEmpty(appId) ? DefaultAppId : appId;

    Console.WriteLine();
    Console.WriteLine($"AUMID 登錄狀態 (HKCU\\{AumidKeyRoot}\\{effectiveAppId}):");
    string? regDisplay = ReadAumidRegistry(effectiveAppId, "DisplayName");
    string? regIcon = ReadAumidRegistry(effectiveAppId, "IconUri");
    if (regDisplay is null && regIcon is null)
    {
        Console.WriteLine("  (尚未註冊)");
    }
    else
    {
        Console.WriteLine($"  DisplayName = {regDisplay ?? "(未設定)"}");
        Console.WriteLine($"  IconUri     = {regIcon ?? "(未設定)"}");
    }
}

static void PrintEnvOption(string key, string envName, string defaultLabel, string suffix = "")
{
    string? value = ReadUserEnv(envName);
    Console.WriteLine($"  {key}) 設定 {envName}{suffix}");
    Console.WriteLine($"       目前: {(string.IsNullOrEmpty(value) ? "(未設定)" : value)}");
    Console.WriteLine($"       預設: {defaultLabel}");
}

static string? ReadUserEnv(string name)
    => Environment.GetEnvironmentVariable(name, EnvironmentVariableTarget.User);

static void SetUserEnv(string name, string? value)
    => Environment.SetEnvironmentVariable(name, string.IsNullOrEmpty(value) ? null : value, EnvironmentVariableTarget.User);

void PromptAndSetEnv(string name, string description, Func<string, string?>? validator)
{
    Console.WriteLine();
    Console.WriteLine(description);
    string? current = ReadUserEnv(name);
    Console.WriteLine($"目前: {(string.IsNullOrEmpty(current) ? "(未設定)" : current)}");
    Console.Write("新值 (留空 = 清除, Ctrl+C 離開): ");
    string? input = Console.ReadLine();
    if (input is null) { Pause(); return; }
    input = input.Trim();
    if (validator is not null)
    {
        var error = validator(input);
        if (error is not null) { Console.WriteLine($"  ! {error}"); Pause(); return; }
    }
    SetUserEnv(name, input);
    Console.WriteLine(string.IsNullOrEmpty(input) ? $"  已清除 {name}." : $"  已設定 {name} = {input}");
    PrintRestartHint();
    Pause();
}

void ConfigureAppId()
{
    Console.WriteLine();
    Console.WriteLine("CLAUDE_NOTIFY_APP_ID 是 toast 使用的 AUMID. 設定時會一併寫入");
    Console.WriteLine($"HKCU\\{AumidKeyRoot}\\<AppId>, 讓 toast 標頭顯示正確的 DisplayName.");
    string? current = ReadUserEnv("CLAUDE_NOTIFY_APP_ID");
    Console.WriteLine($"目前: {(string.IsNullOrEmpty(current) ? $"(未設定, runtime 預設 {DefaultAppId})" : current)}");
    Console.Write($"新 AppId (留空 = 清除環境變數, 改用預設 '{DefaultAppId}'): ");
    string? input = Console.ReadLine()?.Trim();
    if (input is null) { Pause(); return; }

    string targetAppId = string.IsNullOrEmpty(input) ? DefaultAppId : input;
    string previousEffective = string.IsNullOrEmpty(current) ? DefaultAppId : current;

    Console.Write($"AUMID DisplayName [{DefaultDisplayName}]: ");
    string? displayName = Console.ReadLine()?.Trim();
    if (string.IsNullOrEmpty(displayName)) displayName = DefaultDisplayName;

    SetUserEnv("CLAUDE_NOTIFY_APP_ID", input);
    RegisterAumid(targetAppId, displayName);

    Console.WriteLine();
    Console.WriteLine(string.IsNullOrEmpty(input)
        ? $"  已清除 CLAUDE_NOTIFY_APP_ID, 並註冊 AUMID '{targetAppId}'."
        : $"  已設定 CLAUDE_NOTIFY_APP_ID = {input}, 並註冊 AUMID '{targetAppId}'.");

    if (!string.Equals(previousEffective, targetAppId, StringComparison.OrdinalIgnoreCase) &&
        AumidExists(previousEffective))
    {
        Console.Write($"  偵測到舊 AUMID '{previousEffective}' 仍存在. 是否一併移除? (y/N): ");
        string? answer = Console.ReadLine()?.Trim().ToLowerInvariant();
        if (answer is "y" or "yes")
        {
            UnregisterAumid(previousEffective);
            Console.WriteLine($"  已移除舊 AUMID '{previousEffective}'.");
        }
    }

    PrintRestartHint();
    Pause();
}

void ReregisterCurrentAppId()
{
    string? envAppId = ReadUserEnv("CLAUDE_NOTIFY_APP_ID");
    string targetAppId = string.IsNullOrEmpty(envAppId) ? DefaultAppId : envAppId;
    Console.WriteLine();
    Console.WriteLine($"重新註冊 AUMID '{targetAppId}'.");
    Console.Write($"DisplayName [{DefaultDisplayName}]: ");
    string? displayName = Console.ReadLine()?.Trim();
    if (string.IsNullOrEmpty(displayName)) displayName = DefaultDisplayName;
    RegisterAumid(targetAppId, displayName);
    Console.WriteLine($"  已註冊 AUMID '{targetAppId}' (DisplayName = {displayName}).");
    Pause();
}

void UnregisterPrompt()
{
    string? envAppId = ReadUserEnv("CLAUDE_NOTIFY_APP_ID");
    string targetAppId = string.IsNullOrEmpty(envAppId) ? DefaultAppId : envAppId;
    Console.WriteLine();
    Console.Write($"確定要移除 AUMID '{targetAppId}'? (y/N): ");
    string? answer = Console.ReadLine()?.Trim().ToLowerInvariant();
    if (answer is not ("y" or "yes")) { Console.WriteLine("  已取消."); Pause(); return; }
    bool removed = UnregisterAumid(targetAppId);
    Console.WriteLine(removed ? $"  已移除 AUMID '{targetAppId}'." : $"  AUMID '{targetAppId}' 原本就未註冊.");
    Pause();
}

void ClearAllPrompt()
{
    Console.WriteLine();
    Console.Write("確定要清除全部 CLAUDE_NOTIFY_* 使用者環境變數? (y/N): ");
    string? answer = Console.ReadLine()?.Trim().ToLowerInvariant();
    if (answer is not ("y" or "yes")) { Console.WriteLine("  已取消."); Pause(); return; }

    var names = new[]
    {
        "CLAUDE_NOTIFY_TITLE",
        "CLAUDE_NOTIFY_APP_ID",
        "CLAUDE_NOTIFY_ICON",
        "CLAUDE_NOTIFY_ICON_CROP",
        "CLAUDE_NOTIFY_DURATION",
    };

    Console.WriteLine();
    Console.WriteLine("正在清除 CLAUDE_NOTIFY_* 環境變數...");

    int cleared = 0;
    int skipped = 0;
    for (int i = 0; i < names.Length; i++)
    {
        string name = names[i];
        string progress = $"  [{i + 1}/{names.Length}] {name,-26}";

        // SetEnvironmentVariable(..., User) broadcasts WM_SETTINGCHANGE; flush
        // each step before the call so the user sees what's in flight, not what
        // already finished.
        Console.Write($"{progress} ... ");

        string? previous = ReadUserEnv(name);
        if (string.IsNullOrEmpty(previous))
        {
            Console.WriteLine("已跳過 (原本就未設定)");
            skipped++;
            continue;
        }

        SetUserEnv(name, null);
        Console.WriteLine($"已清除 (原值: {Truncate(previous, 40)})");
        cleared++;
    }

    Console.WriteLine();
    Console.WriteLine($"完成. 已清除 {cleared} 個, 跳過 {skipped} 個.");
    if (cleared > 0) PrintRestartHint();
    Pause();
}

static string Truncate(string value, int max)
    => value.Length <= max ? value : value.Substring(0, max - 1) + "...";

void RegisterAumid(string appId, string displayName)
{
    string keyPath = $@"{AumidKeyRoot}\{appId}";
    using var key = Registry.CurrentUser.CreateSubKey(keyPath, writable: true)
        ?? throw new InvalidOperationException($"無法開啟 HKCU\\{keyPath}");
    key.SetValue("DisplayName", displayName, RegistryValueKind.String);
    if (File.Exists(defaultIconPath))
    {
        key.SetValue("IconUri", defaultIconPath, RegistryValueKind.String);
    }
    else
    {
        // 移除過期的 IconUri, 避免指向已被刪除的檔案.
        key.DeleteValue("IconUri", throwOnMissingValue: false);
    }
}

static bool UnregisterAumid(string appId)
{
    string keyPath = $@"{AumidKeyRoot}\{appId}";
    using var probe = Registry.CurrentUser.OpenSubKey(keyPath);
    if (probe is null) return false;
    probe.Dispose();
    Registry.CurrentUser.DeleteSubKeyTree(keyPath, throwOnMissingSubKey: false);
    return true;
}

static bool AumidExists(string appId)
{
    using var key = Registry.CurrentUser.OpenSubKey($@"{AumidKeyRoot}\{appId}");
    return key is not null;
}

static string? ReadAumidRegistry(string appId, string valueName)
{
    using var key = Registry.CurrentUser.OpenSubKey($@"{AumidKeyRoot}\{appId}");
    return key?.GetValue(valueName) as string;
}

static void PrintRestartHint()
{
    Console.WriteLine();
    Console.WriteLine("  提示: 環境變數寫入 HKCU\\Environment, 需要重啟 Claude Code");
    Console.WriteLine("        或新開一個終端機才會生效.");
}

static void Pause()
{
    Console.WriteLine();
    Console.Write("按 Enter 繼續...");
    Console.ReadLine();
}
