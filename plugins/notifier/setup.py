#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# ///
"""Interactive setup tool for the notifier plugin (Windows only).

- Persists CLAUDE_NOTIFY_* environment variables to HKCU\\Environment so future
  Claude Code sessions inherit them.
- When CLAUDE_NOTIFY_APP_ID changes, also writes the matching AUMID record to
  HKCU\\Software\\Classes\\AppUserModelId\\<AppId> so Windows shows the desired
  DisplayName on the toast header.
"""
from __future__ import annotations

import os
import platform
import sys
from pathlib import Path

if platform.system() != "Windows":
    print("setup.py 只支援 Windows. macOS 請在 shell profile (例如 ~/.zshrc) 直接 export.")
    sys.exit(1)

import ctypes  # noqa: E402
import winreg  # noqa: E402

DEFAULT_APP_ID = "ClaudeCode.Notifier"
DEFAULT_DISPLAY_NAME = "Claude Code"
AUMID_KEY_ROOT = r"Software\Classes\AppUserModelId"
ENV_KEY = "Environment"

SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_ICON_PATH = str(SCRIPT_DIR / "app.ico")


def main() -> int:
    while True:
        safe_clear()
        write_header("Claude Code Notifier - 設定工具")
        print_aumid_status()

        print()
        print("操作:")
        print_env_option("1", "CLAUDE_NOTIFY_TITLE", "(顯示 cwd 名稱)")
        print_env_option("2", "CLAUDE_NOTIFY_APP_ID", DEFAULT_APP_ID, suffix=" (一併註冊 AUMID)")
        print_env_option("3", "CLAUDE_NOTIFY_ICON", DEFAULT_ICON_PATH)
        print_env_option("4", "CLAUDE_NOTIFY_ICON_CROP", "square")
        print_env_option("5", "CLAUDE_NOTIFY_DURATION", "long")
        print("  6) 重新註冊 AUMID (使用目前的 APP_ID)")
        print("  7) 移除 AUMID 註冊")
        print("  8) 清除全部 CLAUDE_NOTIFY_* 環境變數")
        print("  q) 離開")
        try:
            choice = input("\n選擇: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            return 0
        if not choice:
            continue

        if choice == "1":
            prompt_and_set_env(
                "CLAUDE_NOTIFY_TITLE",
                'Toast 標題前綴, 會以 "<title> - <cwd>" 形式顯示. 留空表示清除.',
                validator=None,
            )
        elif choice == "2":
            configure_app_id()
        elif choice == "3":
            prompt_and_set_env(
                "CLAUDE_NOTIFY_ICON",
                "Icon 檔案絕對路徑. 留空表示清除 (改用 plugin 內 app.ico).",
                validator=lambda v: None if not v or Path(v).exists() else "找不到該檔案, 請確認絕對路徑.",
            )
        elif choice == "4":
            prompt_and_set_env(
                "CLAUDE_NOTIFY_ICON_CROP",
                "Icon 裁切方式: 'square' 或 'circle'. 留空表示清除 (預設 square).",
                validator=lambda v: None if not v or v in ("square", "circle") else "只接受 'square' 或 'circle'.",
            )
        elif choice == "5":
            prompt_and_set_env(
                "CLAUDE_NOTIFY_DURATION",
                "Toast 持續時間: 'short' (~5s) 或 'long' (~25s). 留空表示清除 (預設 long).",
                validator=lambda v: None if not v or v in ("short", "long") else "只接受 'short' 或 'long'.",
            )
        elif choice == "6":
            reregister_current_app_id()
        elif choice == "7":
            unregister_prompt()
        elif choice == "8":
            clear_all_prompt()
        elif choice in ("q", "exit", "quit"):
            return 0
        else:
            print(f"未知選項: {choice}")
            pause()


# ===== Console helpers =====

def safe_clear() -> None:
    try:
        os.system("cls")
    except Exception:
        print("\n\n")


def write_header(title: str) -> None:
    line = "=" * max(len(title), 32)
    print(line)
    print(title)
    print(line)


def pause() -> None:
    print()
    try:
        input("按 Enter 繼續...")
    except (EOFError, KeyboardInterrupt):
        pass


def print_restart_hint() -> None:
    print()
    print("  提示: 環境變數寫入 HKCU\\Environment, 需要重啟 Claude Code")
    print("        或新開一個終端機才會生效.")


def truncate(value: str, max_len: int) -> str:
    return value if len(value) <= max_len else value[: max_len - 1] + "..."


# ===== Env var helpers =====

def read_user_env(name: str) -> str | None:
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, ENV_KEY, 0, winreg.KEY_READ) as key:
            value, _ = winreg.QueryValueEx(key, name)
            return value if isinstance(value, str) and value else None
    except FileNotFoundError:
        return None
    except OSError:
        return None


def set_user_env(name: str, value: str | None) -> None:
    # Mirror .NET Environment.SetEnvironmentVariable(..., User):
    # writing None deletes the value, writing a value uses REG_EXPAND_SZ if it
    # contains %VAR%, otherwise REG_SZ.
    with winreg.OpenKey(
        winreg.HKEY_CURRENT_USER, ENV_KEY, 0, winreg.KEY_READ | winreg.KEY_WRITE
    ) as key:
        if value is None or value == "":
            try:
                winreg.DeleteValue(key, name)
            except FileNotFoundError:
                pass
        else:
            kind = winreg.REG_EXPAND_SZ if "%" in value else winreg.REG_SZ
            winreg.SetValueEx(key, name, 0, kind, value)
    broadcast_setting_change()


def broadcast_setting_change() -> None:
    # Notify other processes that environment variables changed. .NET does this
    # implicitly inside SetEnvironmentVariable; we have to do it by hand.
    HWND_BROADCAST = 0xFFFF
    WM_SETTINGCHANGE = 0x001A
    SMTO_ABORTIFHUNG = 0x0002
    result = ctypes.c_long()
    ctypes.windll.user32.SendMessageTimeoutW(
        HWND_BROADCAST,
        WM_SETTINGCHANGE,
        0,
        ctypes.c_wchar_p("Environment"),
        SMTO_ABORTIFHUNG,
        1000,
        ctypes.byref(result),
    )


def print_env_option(key: str, env_name: str, default_label: str, suffix: str = "") -> None:
    value = read_user_env(env_name)
    print(f"  {key}) 設定 {env_name}{suffix}")
    print(f"       目前: {'(未設定)' if not value else value}")
    print(f"       預設: {default_label}")


def prompt_and_set_env(name: str, description: str, validator) -> None:
    print()
    print(description)
    current = read_user_env(name)
    print(f"目前: {'(未設定)' if not current else current}")
    try:
        raw = input("新值 (留空 = 清除, Ctrl+C 離開): ")
    except (EOFError, KeyboardInterrupt):
        pause()
        return
    value = raw.strip()
    if validator is not None:
        error = validator(value)
        if error is not None:
            print(f"  ! {error}")
            pause()
            return
    set_user_env(name, value or None)
    print(f"  已清除 {name}." if not value else f"  已設定 {name} = {value}")
    print_restart_hint()
    pause()


# ===== AUMID helpers =====

def print_aumid_status() -> None:
    app_id = read_user_env("CLAUDE_NOTIFY_APP_ID")
    effective = app_id if app_id else DEFAULT_APP_ID
    print()
    print(f"AUMID 登錄狀態 (HKCU\\{AUMID_KEY_ROOT}\\{effective}):")
    display = read_aumid_value(effective, "DisplayName")
    icon = read_aumid_value(effective, "IconUri")
    if display is None and icon is None:
        print("  (尚未註冊)")
    else:
        print(f"  DisplayName = {display if display else '(未設定)'}")
        print(f"  IconUri     = {icon if icon else '(未設定)'}")


def read_aumid_value(app_id: str, value_name: str) -> str | None:
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, f"{AUMID_KEY_ROOT}\\{app_id}", 0, winreg.KEY_READ
        ) as key:
            value, _ = winreg.QueryValueEx(key, value_name)
            return value if isinstance(value, str) else None
    except FileNotFoundError:
        return None
    except OSError:
        return None


def aumid_exists(app_id: str) -> bool:
    try:
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER, f"{AUMID_KEY_ROOT}\\{app_id}", 0, winreg.KEY_READ
        ):
            return True
    except FileNotFoundError:
        return False
    except OSError:
        return False


def register_aumid(app_id: str, display_name: str) -> None:
    key_path = f"{AUMID_KEY_ROOT}\\{app_id}"
    with winreg.CreateKeyEx(
        winreg.HKEY_CURRENT_USER, key_path, 0, winreg.KEY_READ | winreg.KEY_WRITE
    ) as key:
        winreg.SetValueEx(key, "DisplayName", 0, winreg.REG_SZ, display_name)
        if Path(DEFAULT_ICON_PATH).exists():
            winreg.SetValueEx(key, "IconUri", 0, winreg.REG_SZ, DEFAULT_ICON_PATH)
        else:
            # Drop stale IconUri pointing at a deleted file.
            try:
                winreg.DeleteValue(key, "IconUri")
            except FileNotFoundError:
                pass


def unregister_aumid(app_id: str) -> bool:
    key_path = f"{AUMID_KEY_ROOT}\\{app_id}"
    if not aumid_exists(app_id):
        return False
    delete_subkey_tree(winreg.HKEY_CURRENT_USER, key_path)
    return True


def delete_subkey_tree(root, path: str) -> None:
    try:
        with winreg.OpenKey(root, path, 0, winreg.KEY_READ | winreg.KEY_WRITE) as key:
            while True:
                try:
                    subname = winreg.EnumKey(key, 0)
                except OSError:
                    break
                delete_subkey_tree(root, f"{path}\\{subname}")
    except FileNotFoundError:
        return
    winreg.DeleteKey(root, path)


def configure_app_id() -> None:
    print()
    print("CLAUDE_NOTIFY_APP_ID 是 toast 使用的 AUMID. 設定時會一併寫入")
    print(f"HKCU\\{AUMID_KEY_ROOT}\\<AppId>, 讓 toast 標頭顯示正確的 DisplayName.")
    current = read_user_env("CLAUDE_NOTIFY_APP_ID")
    print(f"目前: {f'(未設定, runtime 預設 {DEFAULT_APP_ID})' if not current else current}")
    try:
        raw = input(f"新 AppId (留空 = 清除環境變數, 改用預設 '{DEFAULT_APP_ID}'): ")
    except (EOFError, KeyboardInterrupt):
        pause()
        return
    new_input = raw.strip()
    target_app_id = new_input if new_input else DEFAULT_APP_ID
    previous_effective = current if current else DEFAULT_APP_ID

    try:
        display_name = input(f"AUMID DisplayName [{DEFAULT_DISPLAY_NAME}]: ").strip()
    except (EOFError, KeyboardInterrupt):
        pause()
        return
    if not display_name:
        display_name = DEFAULT_DISPLAY_NAME

    set_user_env("CLAUDE_NOTIFY_APP_ID", new_input or None)
    register_aumid(target_app_id, display_name)

    print()
    if not new_input:
        print(f"  已清除 CLAUDE_NOTIFY_APP_ID, 並註冊 AUMID '{target_app_id}'.")
    else:
        print(f"  已設定 CLAUDE_NOTIFY_APP_ID = {new_input}, 並註冊 AUMID '{target_app_id}'.")

    if previous_effective.lower() != target_app_id.lower() and aumid_exists(previous_effective):
        try:
            answer = input(f"  偵測到舊 AUMID '{previous_effective}' 仍存在. 是否一併移除? (y/N): ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            answer = ""
        if answer in ("y", "yes"):
            unregister_aumid(previous_effective)
            print(f"  已移除舊 AUMID '{previous_effective}'.")

    print_restart_hint()
    pause()


def reregister_current_app_id() -> None:
    env_app_id = read_user_env("CLAUDE_NOTIFY_APP_ID")
    target_app_id = env_app_id if env_app_id else DEFAULT_APP_ID
    print()
    print(f"重新註冊 AUMID '{target_app_id}'.")
    try:
        display_name = input(f"DisplayName [{DEFAULT_DISPLAY_NAME}]: ").strip()
    except (EOFError, KeyboardInterrupt):
        pause()
        return
    if not display_name:
        display_name = DEFAULT_DISPLAY_NAME
    register_aumid(target_app_id, display_name)
    print(f"  已註冊 AUMID '{target_app_id}' (DisplayName = {display_name}).")
    pause()


def unregister_prompt() -> None:
    env_app_id = read_user_env("CLAUDE_NOTIFY_APP_ID")
    target_app_id = env_app_id if env_app_id else DEFAULT_APP_ID
    print()
    try:
        answer = input(f"確定要移除 AUMID '{target_app_id}'? (y/N): ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        answer = ""
    if answer not in ("y", "yes"):
        print("  已取消.")
        pause()
        return
    removed = unregister_aumid(target_app_id)
    print(
        f"  已移除 AUMID '{target_app_id}'." if removed else f"  AUMID '{target_app_id}' 原本就未註冊."
    )
    pause()


def clear_all_prompt() -> None:
    print()
    try:
        answer = input("確定要清除全部 CLAUDE_NOTIFY_* 使用者環境變數? (y/N): ").strip().lower()
    except (EOFError, KeyboardInterrupt):
        answer = ""
    if answer not in ("y", "yes"):
        print("  已取消.")
        pause()
        return

    names = [
        "CLAUDE_NOTIFY_TITLE",
        "CLAUDE_NOTIFY_APP_ID",
        "CLAUDE_NOTIFY_ICON",
        "CLAUDE_NOTIFY_ICON_CROP",
        "CLAUDE_NOTIFY_DURATION",
    ]

    print()
    print("正在清除 CLAUDE_NOTIFY_* 環境變數...")

    cleared = 0
    skipped = 0
    for i, name in enumerate(names, start=1):
        progress = f"  [{i}/{len(names)}] {name:<26}"
        print(f"{progress} ... ", end="", flush=True)

        previous = read_user_env(name)
        if not previous:
            print("已跳過 (原本就未設定)")
            skipped += 1
            continue

        set_user_env(name, None)
        print(f"已清除 (原值: {truncate(previous, 40)})")
        cleared += 1

    print()
    print(f"完成. 已清除 {cleared} 個, 跳過 {skipped} 個.")
    if cleared > 0:
        print_restart_hint()
    pause()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(0)
