#:property TargetFramework=net10.0-windows10.0.19041.0

using System.Text.Json;
using Windows.UI.Notifications;
using Windows.Data.Xml.Dom;

// Dual-mode entrypoint. Mode is selected by the first arg, NOT by stdin
// redirect status: a non-interactive shell wrapper can hand the script an
// open-but-idle stdin pipe, and Console.In.ReadToEnd() would deadlock there.
//
// Hook mode (invoked from hooks.json):
//   Reads a Claude Code hook event JSON from stdin and fires a state-aware Windows Toast.
//   Always exits 0 so toast failures never disrupt Claude Code.
//     dotnet run <path-to>/notify.cs -- --hook <plugin-root>
//
// CLI mode (manual / scripted use):
//   Argv-driven toast for testing the pipeline without a hook event.
//     dotnet run <path-to>/notify.cs -- <title> [body] [--icon <path>] [--icon-crop circle|square] [--app-id <id>]
//
// Environment overrides (hook mode only):
//   CLAUDE_NOTIFY_TITLE, CLAUDE_NOTIFY_APP_ID, CLAUDE_NOTIFY_ICON, CLAUDE_NOTIFY_ICON_CROP

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

    ShowToast(title, body, iconPath, iconCrop, appId);
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
        Console.WriteLine("Usage: dotnet run notify.cs -- <title> [body] [--icon <path>] [--icon-crop circle|square] [--app-id <id>]");
        Console.WriteLine("  title         Notification title (required)");
        Console.WriteLine("  body          Notification body text (optional)");
        Console.WriteLine("  --icon        Icon image: local path, file:// URI or http(s):// URL");
        Console.WriteLine("  --icon-crop   Icon crop style: circle or square (default: square)");
        Console.WriteLine("  --app-id      Application User Model ID (default: ClaudeCode.Notifier)");
        return args.Length == 0 ? 1 : 0;
    }

    string? iconPath = null;
    string iconCrop = "square";
    string appId = "ClaudeCode.Notifier";
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

    ShowToast(title, body, iconPath ?? "", iconCrop, appId);
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

static void ShowToast(string title, string body, string iconPath, string iconCrop, string appId)
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

    var xml = $"""
<toast>
  <visual>
    <binding template="ToastGeneric">
      {iconXml}
      <text>{System.Security.SecurityElement.Escape(title)}</text>
      <text>{System.Security.SecurityElement.Escape(body)}</text>
    </binding>
  </visual>
</toast>
""";

    var doc = new XmlDocument();
    doc.LoadXml(xml);
    ToastNotificationManager.CreateToastNotifier(appId).Show(new ToastNotification(doc));
}
