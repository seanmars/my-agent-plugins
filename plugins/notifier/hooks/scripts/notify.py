#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""Dual-mode entrypoint for the notifier plugin.

Hook mode (invoked from hooks.json):
    uv run notify.py --hook <plugin-root>

CLI mode:
    uv run notify.py <title> [body] [--icon <path>] [--icon-crop circle|square]
                     [--app-id <id>] [--duration short|long]
"""
from __future__ import annotations

import base64
import json
import os
import platform
import subprocess
import sys
import xml.sax.saxutils as sax
from pathlib import Path

# Claude Code emits UTF-8 hook JSON but Windows defaults stdin to the OEM code
# page (CP950 / CP936), which mangles non-ASCII bytes before json.loads sees
# them. Force UTF-8 on both streams.
for stream in (sys.stdin, sys.stdout):
    if stream is not None and hasattr(stream, "reconfigure"):
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass


def main(argv: list[str]) -> int:
    if argv and argv[0] == "--hook":
        plugin_root = argv[1] if len(argv) > 1 else ""
        return run_hook(plugin_root)
    return run_cli(argv)


def run_hook(plugin_root: str) -> int:
    try:
        raw = sys.stdin.read()
        if not raw or not raw.strip():
            return 0
        data = json.loads(raw)
        event = data.get("hook_event_name")
        if not event:
            return 0
        reason = build_reason(data, event)
        if not reason:
            return 0

        title = os.environ.get("CLAUDE_NOTIFY_TITLE", "")
        app_id = os.environ.get("CLAUDE_NOTIFY_APP_ID", "ClaudeCode.Notifier")
        icon_crop = os.environ.get("CLAUDE_NOTIFY_ICON_CROP", "square")
        duration = os.environ.get("CLAUDE_NOTIFY_DURATION", "long")
        icon_path = os.environ.get("CLAUDE_NOTIFY_ICON") or (
            str(Path(plugin_root) / "app.ico") if plugin_root else ""
        )

        cwd = data.get("cwd")
        cwd_name = Path(cwd).name if cwd else None

        if not title:
            title = cwd_name or ""
        elif cwd_name:
            title = f"{title} - {cwd_name}"

        show_toast(title, reason, icon_path, icon_crop, app_id, duration)
    except Exception:
        # Swallow all errors; toast failures must never disrupt Claude.
        pass
    return 0


def run_cli(argv: list[str]) -> int:
    if not argv or argv[0] in ("-h", "--help"):
        print(
            "Usage: uv run notify.py <title> [body] [--icon <path>] "
            "[--icon-crop circle|square] [--app-id <id>] [--duration short|long]"
        )
        print("  title         Notification title (required)")
        print("  body          Notification body text (optional)")
        print("  --icon        Icon image: local path, file:// URI or http(s):// URL (Windows only)")
        print("  --icon-crop   Icon crop style: circle or square (default: square; Windows only)")
        print("  --app-id      Application User Model ID (default: ClaudeCode.Notifier; Windows only)")
        print("  --duration    Toast duration: short (~5s) or long (~25s) (default: long; Windows only)")
        return 1 if not argv else 0

    icon_path: str | None = None
    icon_crop = "square"
    app_id = "ClaudeCode.Notifier"
    duration = "long"
    positional: list[str] = []

    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--icon" and i + 1 < len(argv):
            icon_path = argv[i + 1]
            i += 2
        elif a == "--icon-crop" and i + 1 < len(argv):
            icon_crop = argv[i + 1]
            i += 2
        elif a == "--app-id" and i + 1 < len(argv):
            app_id = argv[i + 1]
            i += 2
        elif a == "--duration" and i + 1 < len(argv):
            duration = argv[i + 1]
            i += 2
        else:
            positional.append(a)
            i += 1

    if not positional:
        print("Error: title is required. Run with --help for usage.", file=sys.stderr)
        return 1

    title = positional[0]
    body = positional[1] if len(positional) > 1 else ""
    show_toast(title, body, icon_path or "", icon_crop, app_id, duration)
    return 0


def build_reason(data: dict, event: str) -> str | None:
    if event == "Stop":
        return "Awaiting your input"

    if event == "Notification":
        notif_type = data.get("notification_type")
        # PermissionRequest fires for the same dialog; skip to avoid duplicate toasts.
        if notif_type == "permission_prompt":
            return None
        prefix = {
            "idle_prompt": "Awaiting your input",
            "elicitation_dialog": "Input requested",
            "elicitation_complete": "Input received",
            "elicitation_response": "Input response",
            "auth_success": "Authenticated",
        }.get(notif_type, "Attention needed")
        msg = data.get("message") or ""
        return f"{prefix}: {msg}" if msg else prefix

    if event == "PermissionRequest":
        tool = data.get("tool_name")
        return f"Permission required: {tool}" if tool else "Permission required"

    if event == "PreToolUse":
        tool = data.get("tool_name")
        if tool == "AskUserQuestion":
            q = get_first_question(data)
            return f"Question: {q}" if q else "Claude is asking you a question"
        if tool == "ExitPlanMode":
            return "Plan ready - approval needed"
        return None

    if event == "SessionEnd":
        exit_reason = data.get("exit_reason")
        return f"Session ended ({exit_reason})" if exit_reason else "Session ended"

    return None


def get_first_question(data: dict) -> str | None:
    try:
        questions = data["tool_input"]["questions"]
        if questions:
            return questions[0].get("question")
    except (KeyError, IndexError, TypeError):
        pass
    return None


def show_toast(title: str, body: str, icon_path: str, icon_crop: str, app_id: str, duration: str) -> None:
    try:
        system = platform.system()
        if system == "Windows":
            show_toast_windows(title, body, icon_path, icon_crop, app_id, duration)
        elif system == "Darwin":
            show_toast_macos(title, body, icon_path, app_id)
        # Linux / other: silent no-op.
    except Exception:
        pass


def xml_escape(s: str) -> str:
    return sax.escape(s, {'"': "&quot;", "'": "&apos;"})


def show_toast_windows(
    title: str, body: str, icon_path: str, icon_crop: str, app_id: str, duration: str
) -> None:
    icon_xml = ""
    if icon_path and icon_path.strip():
        if "://" in icon_path:
            src = icon_path
        else:
            src = Path(icon_path).resolve().as_uri()
        crop_attr = ' hint-crop="circle"' if icon_crop.lower() == "circle" else ""
        icon_xml = f'<image placement="appLogoOverride"{crop_attr} src="{xml_escape(src)}"/>'

    # Toast schema only accepts "short" or "long"; anything else makes LoadXml throw.
    duration_attr = ' duration="short"' if duration.lower() == "short" else ' duration="long"'

    xml = (
        f'<toast{duration_attr}>\n'
        f'  <visual>\n'
        f'    <binding template="ToastGeneric">\n'
        f'      {icon_xml}\n'
        f'      <text>{xml_escape(title)}</text>\n'
        f'      <text>{xml_escape(body)}</text>\n'
        f'    </binding>\n'
        f'  </visual>\n'
        f'</toast>'
    )

    # PowerShell single-quoted string: '' is the only escape needed.
    xml_for_ps = xml.replace("'", "''")
    app_id_for_ps = app_id.replace("'", "''")

    ps = (
        "[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] | Out-Null\n"
        "[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType=WindowsRuntime] | Out-Null\n"
        "$xml = New-Object Windows.Data.Xml.Dom.XmlDocument\n"
        f"$xml.LoadXml('{xml_for_ps}')\n"
        f"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{app_id_for_ps}')"
        ".Show([Windows.UI.Notifications.ToastNotification]::new($xml))\n"
    )

    # -EncodedCommand sidesteps cmd.exe / PowerShell quoting entirely.
    # PowerShell expects UTF-16LE base64.
    encoded = base64.b64encode(ps.encode("utf-16-le")).decode("ascii")

    subprocess.run(
        ["powershell.exe", "-NoProfile", "-EncodedCommand", encoded],
        capture_output=True,
        timeout=10,
    )


def show_toast_macos(title: str, body: str, icon_path: str, app_id: str) -> None:
    tn = find_terminal_notifier()
    if tn:
        run_terminal_notifier(tn, title, body, icon_path, app_id)
    else:
        run_osascript(title, body)


def find_terminal_notifier() -> str | None:
    # Check Homebrew default paths first (Apple Silicon, Intel) so we don't pay
    # a /usr/bin/which fork on every notification.
    for p in ("/opt/homebrew/bin/terminal-notifier", "/usr/local/bin/terminal-notifier"):
        if Path(p).exists():
            return p
    try:
        result = subprocess.run(
            ["/usr/bin/which", "terminal-notifier"],
            capture_output=True,
            text=True,
            timeout=2,
        )
        path = result.stdout.strip()
        if result.returncode == 0 and path and Path(path).exists():
            return path
    except Exception:
        pass
    return None


def run_terminal_notifier(exe: str, title: str, body: str, icon_path: str, app_id: str) -> None:
    args = [exe, "-title", title, "-message", body]

    # -group dedupes: a new notification with the same group replaces the older
    # banner instead of stacking.
    if app_id and app_id.strip():
        args += ["-group", app_id]

    # -appIcon is best-effort on modern macOS: Apple restricts sender icon
    # overrides. Default app.ico is unreadable here, so skip unless the user
    # pointed CLAUDE_NOTIFY_ICON at a raster format (PNG / JPG).
    if (
        icon_path
        and icon_path.strip()
        and not icon_path.lower().endswith(".ico")
        and Path(icon_path).exists()
    ):
        args += ["-appIcon", str(Path(icon_path).resolve())]

    subprocess.run(args, capture_output=True, timeout=5)


def run_osascript(title: str, body: str) -> None:
    def sanitize(s: str) -> str:
        return s.replace("\r\n", " ").replace("\r", " ").replace("\n", " ")

    def esc(s: str) -> str:
        return sanitize(s).replace("\\", "\\\\").replace('"', '\\"')

    script = f'display notification "{esc(body)}" with title "{esc(title)}"'
    subprocess.run(["osascript", "-e", script], capture_output=True, timeout=5)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
