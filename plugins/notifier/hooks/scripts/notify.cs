#:property TargetFramework=net10.0

using System.Diagnostics;
using System.Text;
using System.Text.Json;

// Dual-mode entrypoint. Mode is selected by the first arg, NOT by stdin
// redirect status: a non-interactive shell wrapper can hand the script an
// open-but-idle stdin pipe, and Console.In.ReadToEnd() would deadlock there.
//
// Hook mode (invoked from hooks.json):
//   Reads a Claude Code hook event JSON from stdin and fires a state-aware native toast.
//   Always exits 0 so toast failures never disrupt Claude Code.
//     dotnet run <path-to>/notify.cs -- --hook <plugin-root>
//
// CLI mode (manual / scripted use):
//   Argv-driven toast for testing the pipeline without a hook event.
//     dotnet run <path-to>/notify.cs -- <title> [body] [--icon <path>] [--icon-crop circle|square] [--app-id <id>] [--duration short|long]
//
// Cross-platform dispatch:
//   Windows -> powershell.exe + WinRT ToastNotificationManager (full feature set:
//             icon, --icon-crop, --app-id, --duration).
//   macOS   -> terminal-notifier if installed (custom icon via --icon, --app-id
//             becomes -group so newer notifications replace older ones from the
//             same context); otherwise falls back to osascript "display notification"
//             (title + body only). osascript path requires granting Script Editor
//             notification permission in System Settings on first run.
//             --icon-crop and --duration are always ignored on macOS.
//   Other   -> silent no-op.
//
// Environment overrides (hook mode only):
//   CLAUDE_NOTIFY_TITLE, CLAUDE_NOTIFY_APP_ID, CLAUDE_NOTIFY_ICON, CLAUDE_NOTIFY_ICON_CROP, CLAUDE_NOTIFY_DURATION

// Claude Code emits UTF-8 hook JSON, but Windows defaults Console.InputEncoding
// to the OEM code page (e.g. CP950 / CP936), which mangles non-ASCII bytes
// before JsonDocument ever sees them. Force UTF-8 on both streams.
Console.InputEncoding = Encoding.UTF8;
Console.OutputEncoding = Encoding.UTF8;

if (args.Length == 0 || args[0] != "--hook") return RunCli(args);

string hookPluginRoot = args.Length > 1 ? args[1] : "";

// === Hook mode ===
try
{
    string raw = Console.In.ReadToEnd();
    if (string.IsNullOrWhiteSpace(raw)) return 0;

    using var doc = JsonDocument.Parse(raw);
    var root = doc.RootElement;

    string? eventName = root.TryGetProperty("hook_event_name", out var ev) ? ev.GetString() : null;
    if (string.IsNullOrEmpty(eventName)) return 0;

    string? reason = BuildReason(root, eventName);
    if (string.IsNullOrEmpty(reason)) return 0;

    string pluginRoot = hookPluginRoot;

    string title = Environment.GetEnvironmentVariable("CLAUDE_NOTIFY_TITLE") ?? string.Empty;
    string appId = Environment.GetEnvironmentVariable("CLAUDE_NOTIFY_APP_ID") ?? "ClaudeCode.Notifier";
    string iconCrop = Environment.GetEnvironmentVariable("CLAUDE_NOTIFY_ICON_CROP") ?? "square";
    string duration = Environment.GetEnvironmentVariable("CLAUDE_NOTIFY_DURATION") ?? "long";
    string iconPath = Environment.GetEnvironmentVariable("CLAUDE_NOTIFY_ICON")
        ?? (string.IsNullOrEmpty(pluginRoot) ? "" : Path.Combine(pluginRoot, "app.ico"));

    string? cwdName = null;
    if (root.TryGetProperty("cwd", out var cwdEl) && cwdEl.ValueKind == JsonValueKind.String)
    {
        var cwd = cwdEl.GetString();
        if (!string.IsNullOrEmpty(cwd)) cwdName = Path.GetFileName(cwd.TrimEnd('/', '\\'));
    }

    if (string.IsNullOrEmpty(title))
    {
        title = cwdName ?? string.Empty;
    }
    else
    {
        title += string.IsNullOrEmpty(cwdName) ? "" : $" - {cwdName}";
    }

    string body = $"{reason}";

    ShowToast(title, body, iconPath, iconCrop, appId, duration);
}
catch
{
    // Swallow all errors; toast failures must never disrupt Claude.
}

return 0;


static int RunCli(string[] args)
{
    if (args.Length == 0 || args[0] is "-h" or "--help")
    {
        Console.WriteLine("Usage: dotnet run notify.cs -- <title> [body] [--icon <path>] [--icon-crop circle|square] [--app-id <id>] [--duration short|long]");
        Console.WriteLine("  title         Notification title (required)");
        Console.WriteLine("  body          Notification body text (optional)");
        Console.WriteLine("  --icon        Icon image: local path, file:// URI or http(s):// URL (Windows only)");
        Console.WriteLine("  --icon-crop   Icon crop style: circle or square (default: square; Windows only)");
        Console.WriteLine("  --app-id      Application User Model ID (default: ClaudeCode.Notifier; Windows only)");
        Console.WriteLine("  --duration    Toast duration: short (~5s) or long (~25s) (default: long; Windows only)");
        return args.Length == 0 ? 1 : 0;
    }

    string? iconPath = null;
    string iconCrop = "square";
    string appId = "ClaudeCode.Notifier";
    string duration = "long";
    var positional = new List<string>();

    for (int i = 0; i < args.Length; i++)
    {
        switch (args[i])
        {
            case "--icon" when i + 1 < args.Length:
                iconPath = args[++i];
                break;
            case "--icon-crop" when i + 1 < args.Length:
                iconCrop = args[++i];
                break;
            case "--app-id" when i + 1 < args.Length:
                appId = args[++i];
                break;
            case "--duration" when i + 1 < args.Length:
                duration = args[++i];
                break;
            default:
                positional.Add(args[i]);
                break;
        }
    }

    if (positional.Count == 0)
    {
        Console.Error.WriteLine("Error: title is required. Run with --help for usage.");
        return 1;
    }

    var title = positional[0];
    var body = positional.Count > 1 ? positional[1] : string.Empty;

    ShowToast(title, body, iconPath ?? "", iconCrop, appId, duration);
    return 0;
}

static string? BuildReason(JsonElement root, string eventName)
{
    switch (eventName)
    {
        case "Stop":
            return "Awaiting your input";

        case "Notification":
            {
                string? notifType = root.TryGetProperty("notification_type", out var nt) ? nt.GetString() : null;
                // Skip permission_prompt: PermissionRequest covers the same dialog and
                // subscribing to both would fire duplicate toasts.
                if (notifType == "permission_prompt") return null;

                string prefix = notifType switch
                {
                    "idle_prompt" => "Awaiting your input",
                    "elicitation_dialog" => "Input requested",
                    "elicitation_complete" => "Input received",
                    "elicitation_response" => "Input response",
                    "auth_success" => "Authenticated",
                    _ => "Attention needed"
                };
                string msg = root.TryGetProperty("message", out var m) ? (m.GetString() ?? "") : "";
                return string.IsNullOrEmpty(msg) ? prefix : $"{prefix}: {msg}";
            }

        case "PermissionRequest":
            {
                string? tool = root.TryGetProperty("tool_name", out var tn) ? tn.GetString() : null;
                return string.IsNullOrEmpty(tool) ? "Permission required" : $"Permission required: {tool}";
            }

        case "PreToolUse":
            {
                string? tool = root.TryGetProperty("tool_name", out var tn) ? tn.GetString() : null;
                return tool switch
                {
                    "AskUserQuestion" => GetFirstQuestion(root) is { Length: > 0 } q
                                         ? $"Question: {q}"
                                         : "Claude is asking you a question",
                    "ExitPlanMode" => "Plan ready - approval needed",
                    _ => null
                };
            }

        case "SessionEnd":
            {
                string? exit = root.TryGetProperty("exit_reason", out var er) ? er.GetString() : null;
                return string.IsNullOrEmpty(exit) ? "Session ended" : $"Session ended ({exit})";
            }

        default:
            return null;
    }
}

static string? GetFirstQuestion(JsonElement root)
{
    try
    {
        if (root.TryGetProperty("tool_input", out var ti) &&
            ti.TryGetProperty("questions", out var qs) &&
            qs.ValueKind == JsonValueKind.Array &&
            qs.GetArrayLength() > 0 &&
            qs[0].TryGetProperty("question", out var q))
        {
            return q.GetString();
        }
    }
    catch { }
    return null;
}

static void ShowToast(string title, string body, string iconPath, string iconCrop, string appId, string duration)
{
    try
    {
        if (OperatingSystem.IsWindows())
            ShowToastWindows(title, body, iconPath, iconCrop, appId, duration);
        else if (OperatingSystem.IsMacOS())
            ShowToastMacOS(title, body, iconPath, appId);
        // Linux/other: silent no-op.
    }
    catch
    {
        // Swallow; toast failure must not surface as an error.
    }
}

static void ShowToastWindows(string title, string body, string iconPath, string iconCrop, string appId, string duration)
{
    string iconXml = "";
    if (!string.IsNullOrWhiteSpace(iconPath))
    {
        var src = iconPath.Contains("://")
            ? iconPath
            : new Uri(Path.GetFullPath(iconPath)).AbsoluteUri;
        var cropAttr = iconCrop.Equals("circle", StringComparison.OrdinalIgnoreCase)
            ? " hint-crop=\"circle\""
            : "";
        iconXml = $"<image placement=\"appLogoOverride\"{cropAttr} src=\"{System.Security.SecurityElement.Escape(src)}\"/>";
    }

    // Toast schema only allows "short" or "long"; anything else would make
    // LoadXml throw, so fall back to "long" for unknown values.
    var durationAttr = duration.Equals("short", StringComparison.OrdinalIgnoreCase)
        ? " duration=\"short\""
        : " duration=\"long\"";

    var xml = $"""
<toast{durationAttr}>
  <visual>
    <binding template="ToastGeneric">
      {iconXml}
      <text>{System.Security.SecurityElement.Escape(title)}</text>
      <text>{System.Security.SecurityElement.Escape(body)}</text>
    </binding>
  </visual>
</toast>
""";

    // PowerShell single-quoted strings: '' is the only escape needed.
    string xmlForPs = xml.Replace("'", "''");
    string appIdForPs = appId.Replace("'", "''");

    string ps =
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null\n" +
        "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null\n" +
        "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument\n" +
        $"$xml.LoadXml('{xmlForPs}')\n" +
        $"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{appIdForPs}').Show([Windows.UI.Notifications.ToastNotification]::new($xml))\n";

    // -EncodedCommand sidesteps cmd.exe / PowerShell quoting entirely.
    // PowerShell expects UTF-16LE (== Encoding.Unicode) base64.
    string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(ps));

    var psi = new ProcessStartInfo("powershell.exe")
    {
        UseShellExecute = false,
        CreateNoWindow = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
    };
    psi.ArgumentList.Add("-NoProfile");
    psi.ArgumentList.Add("-EncodedCommand");
    psi.ArgumentList.Add(encoded);
    using var p = Process.Start(psi);
    p?.WaitForExit(10000);
}

static void ShowToastMacOS(string title, string body, string iconPath, string appId)
{
    string? tn = FindTerminalNotifier();
    if (tn != null)
        RunTerminalNotifier(tn, title, body, iconPath, appId);
    else
        RunOsascript(title, body);
}

static string? FindTerminalNotifier()
{
    // Check Homebrew default install paths first (Apple Silicon, Intel) so we
    // don't pay a /usr/bin/which fork on every notification.
    string[] common = {
        "/opt/homebrew/bin/terminal-notifier",
        "/usr/local/bin/terminal-notifier",
    };
    foreach (var p in common)
        if (File.Exists(p)) return p;

    try
    {
        var psi = new ProcessStartInfo("/usr/bin/which")
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        psi.ArgumentList.Add("terminal-notifier");
        using var p = Process.Start(psi);
        if (p == null) return null;
        string output = p.StandardOutput.ReadToEnd().Trim();
        p.WaitForExit(2000);
        return p.ExitCode == 0 && File.Exists(output) ? output : null;
    }
    catch
    {
        return null;
    }
}

static void RunTerminalNotifier(string exe, string title, string body, string iconPath, string appId)
{
    var psi = new ProcessStartInfo(exe)
    {
        UseShellExecute = false,
        CreateNoWindow = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
    };
    psi.ArgumentList.Add("-title");
    psi.ArgumentList.Add(title);
    psi.ArgumentList.Add("-message");
    psi.ArgumentList.Add(body);

    // -group dedupes: a new notification with the same group replaces the
    // older banner instead of stacking. Keeps Notification Center tidy when
    // hooks fire in rapid succession.
    if (!string.IsNullOrWhiteSpace(appId))
    {
        psi.ArgumentList.Add("-group");
        psi.ArgumentList.Add(appId);
    }

    // -appIcon is best-effort on modern macOS: Apple restricts which apps can
    // override the sender icon. Defaults to app.ico which terminal-notifier
    // can't render — skip unless the user pointed CLAUDE_NOTIFY_ICON at a
    // raster format (PNG/JPG).
    if (!string.IsNullOrWhiteSpace(iconPath) && File.Exists(iconPath) && !iconPath.EndsWith(".ico", StringComparison.OrdinalIgnoreCase))
    {
        psi.ArgumentList.Add("-appIcon");
        psi.ArgumentList.Add(Path.GetFullPath(iconPath));
    }

    using var p = Process.Start(psi);
    p?.WaitForExit(5000);
}

static void RunOsascript(string title, string body)
{
    // AppleScript "..." literals reject raw newlines; collapse them to spaces.
    static string Sanitize(string s) =>
        s.Replace("\r\n", " ").Replace('\r', ' ').Replace('\n', ' ');

    // AppleScript string literal: \ -> \\, " -> \"
    static string Esc(string s) => Sanitize(s).Replace("\\", "\\\\").Replace("\"", "\\\"");

    string script = $"display notification \"{Esc(body)}\" with title \"{Esc(title)}\"";

    var psi = new ProcessStartInfo("osascript")
    {
        UseShellExecute = false,
        CreateNoWindow = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
    };
    psi.ArgumentList.Add("-e");
    psi.ArgumentList.Add(script);
    using var p = Process.Start(psi);
    p?.WaitForExit(5000);
}
