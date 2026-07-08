#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# ///
"""Fetch Codex rate-limit reset credits from the local Codex OAuth login."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any


DEFAULT_CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/"
RESET_CREDITS_PATH = "/wham/rate-limit-reset-credits"
REFRESH_ENDPOINT = "https://auth.openai.com/oauth/token"
CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann"


class ScriptError(Exception):
    pass


@dataclass(frozen=True)
class Credentials:
    access_token: str
    refresh_token: str
    id_token: str | None
    account_id: str | None
    last_refresh: datetime | None

    @property
    def needs_refresh(self) -> bool:
        if self.last_refresh is None:
            return True
        return datetime.now(UTC) - self.last_refresh > timedelta(days=8)


def main() -> int:
    args = parse_args()
    try:
        auth_path = resolve_auth_path(args)
        auth = load_json_file(auth_path)
        credentials = parse_credentials(auth)

        if credentials.needs_refresh and not args.no_refresh:
            if not credentials.refresh_token:
                print(
                    "warning: access token may be stale and no refresh token is available; trying it anyway",
                    file=sys.stderr,
                )
            else:
                credentials = refresh_credentials(credentials, args.timeout)
                save_credentials(auth_path, auth, credentials)

        base_url = args.base_url or read_chatgpt_base_url(auth_path.parent)
        response = fetch_reset_credits(
            access_token=credentials.access_token,
            account_id=credentials.account_id,
            base_url=base_url,
            timeout=args.timeout,
        )

        if args.raw:
            print(json.dumps(response, indent=2, sort_keys=True))
            return 0

        summary = summarize_response(response)
        if args.json:
            print(json.dumps(summary, indent=2, sort_keys=True))
        else:
            print_human_summary(summary, auth_path)
        return 0
    except ScriptError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("cancelled", file=sys.stderr)
        return 130


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch Codex limit reset credits from ~/.codex/auth.json."
    )
    parser.add_argument(
        "--codex-home",
        help="Codex home directory containing auth.json. Defaults to CODEX_HOME or ~/.codex.",
    )
    parser.add_argument(
        "--auth-file",
        help="Explicit path to Codex auth.json. Overrides --codex-home.",
    )
    parser.add_argument(
        "--base-url",
        help=(
            "ChatGPT backend base URL. Defaults to chatgpt_base_url in config.toml, "
            "then https://chatgpt.com/backend-api/."
        ),
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=10.0,
        help="HTTP timeout in seconds. Default: 10.",
    )
    parser.add_argument(
        "--no-refresh",
        action="store_true",
        help="Do not refresh stale OAuth tokens before querying.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print a normalized JSON summary.",
    )
    parser.add_argument(
        "--raw",
        action="store_true",
        help="Print the raw endpoint JSON response.",
    )
    return parser.parse_args()


def resolve_auth_path(args: argparse.Namespace) -> Path:
    if args.auth_file:
        return Path(args.auth_file).expanduser()
    codex_home = args.codex_home or os.environ.get("CODEX_HOME")
    if codex_home:
        return Path(codex_home).expanduser() / "auth.json"
    return Path.home() / ".codex" / "auth.json"


def load_json_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ScriptError(f"Codex auth.json not found at {path}. Run `codex` to log in.")
    try:
        with path.open("r", encoding="utf-8") as file:
            value = json.load(file)
    except json.JSONDecodeError as error:
        raise ScriptError(f"failed to decode {path}: {error}") from error
    except OSError as error:
        raise ScriptError(f"failed to read {path}: {error}") from error
    if not isinstance(value, dict):
        raise ScriptError(f"{path} is not a JSON object")
    return value


def parse_credentials(auth: dict[str, Any]) -> Credentials:
    tokens = auth.get("tokens")
    if isinstance(tokens, dict):
        access_token = string_value(tokens, "access_token", "accessToken")
        refresh_token = string_value(tokens, "refresh_token", "refreshToken") or ""
        if access_token:
            return Credentials(
                access_token=access_token,
                refresh_token=refresh_token,
                id_token=string_value(tokens, "id_token", "idToken"),
                account_id=string_value(tokens, "account_id", "accountId"),
                last_refresh=parse_datetime(auth.get("last_refresh")),
            )

    api_key = auth.get("OPENAI_API_KEY")
    if isinstance(api_key, str) and api_key.strip():
        return Credentials(
            access_token=api_key.strip(),
            refresh_token="",
            id_token=None,
            account_id=None,
            last_refresh=None,
        )

    raise ScriptError("auth.json exists but contains no Codex OAuth tokens")


def string_value(mapping: dict[str, Any], snake_key: str, camel_key: str) -> str | None:
    for key in (snake_key, camel_key):
        value = mapping.get(key)
        if isinstance(value, str) and value:
            return value
    return None


def parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def refresh_credentials(credentials: Credentials, timeout: float) -> Credentials:
    body = {
        "client_id": CODEX_CLIENT_ID,
        "grant_type": "refresh_token",
        "refresh_token": credentials.refresh_token,
        "scope": "openid profile email",
    }
    request = urllib.request.Request(
        REFRESH_ENDPOINT,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    response = request_json(request, timeout)
    return Credentials(
        access_token=response.get("access_token") or credentials.access_token,
        refresh_token=response.get("refresh_token") or credentials.refresh_token,
        id_token=response.get("id_token") or credentials.id_token,
        account_id=credentials.account_id,
        last_refresh=datetime.now(UTC),
    )


def save_credentials(path: Path, auth: dict[str, Any], credentials: Credentials) -> None:
    tokens = {
        "access_token": credentials.access_token,
        "refresh_token": credentials.refresh_token,
    }
    if credentials.id_token:
        tokens["id_token"] = credentials.id_token
    if credentials.account_id:
        tokens["account_id"] = credentials.account_id

    auth["tokens"] = tokens
    auth["last_refresh"] = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    directory = path.parent
    directory.mkdir(parents=True, exist_ok=True)
    try:
        fd, temp_name = tempfile.mkstemp(
            prefix=f".{path.name}.",
            suffix=".tmp",
            dir=str(directory),
            text=True,
        )
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(auth, file, indent=2, sort_keys=True)
            file.write("\n")
        if os.name != "nt":
            os.chmod(temp_name, 0o600)
        os.replace(temp_name, path)
    except OSError as error:
        raise ScriptError(f"failed to save refreshed credentials to {path}: {error}") from error


def read_chatgpt_base_url(codex_home: Path) -> str:
    config_path = codex_home / "config.toml"
    try:
        contents = config_path.read_text(encoding="utf-8")
    except OSError:
        return DEFAULT_CHATGPT_BASE_URL

    for raw_line in contents.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        match = re.fullmatch(r"chatgpt_base_url\s*=\s*(['\"]?)(.*?)\1", line)
        if match:
            value = match.group(2).strip()
            if value:
                return value
    return DEFAULT_CHATGPT_BASE_URL


def fetch_reset_credits(
    access_token: str,
    account_id: str | None,
    base_url: str,
    timeout: float,
) -> dict[str, Any]:
    url = resolve_reset_credits_url(base_url)
    headers = {
        "Authorization": f"Bearer {access_token}",
        "User-Agent": "CodexBar",
        "Accept": "application/json",
        "OpenAI-Beta": "codex-1",
        "originator": "Codex Desktop",
    }
    if account_id:
        headers["ChatGPT-Account-ID"] = account_id

    request = urllib.request.Request(url, method="GET", headers=headers)
    return request_json(request, timeout)


def resolve_reset_credits_url(base_url: str) -> str:
    normalized = base_url.strip() or DEFAULT_CHATGPT_BASE_URL
    while normalized.endswith("/"):
        normalized = normalized[:-1]
    if (
        normalized.startswith("https://chatgpt.com")
        or normalized.startswith("https://chat.openai.com")
    ) and "/backend-api" not in normalized:
        normalized += "/backend-api"
    return normalized + RESET_CREDITS_PATH


def request_json(request: urllib.request.Request, timeout: float) -> dict[str, Any]:
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read()
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        detail = f"HTTP {error.code}"
        if body:
            detail += f": {body[:1000]}"
        raise ScriptError(detail) from error
    except urllib.error.URLError as error:
        raise ScriptError(f"network error: {error.reason}") from error

    try:
        value = json.loads(data.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise ScriptError(f"endpoint returned invalid JSON: {error}") from error
    if not isinstance(value, dict):
        raise ScriptError("endpoint returned JSON that is not an object")
    return value


def summarize_response(response: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(UTC)
    raw_credits = response.get("credits")
    credits = raw_credits if isinstance(raw_credits, list) else []

    normalized = []
    for credit in credits:
        if not isinstance(credit, dict):
            continue
        expires_at = parse_datetime(credit.get("expires_at"))
        granted_at = parse_datetime(credit.get("granted_at"))
        status = credit.get("status")
        is_available = status == "available" and (expires_at is None or expires_at > now)
        normalized.append(
            {
                "id": credit.get("id"),
                "reset_type": credit.get("reset_type"),
                "status": status,
                "available": is_available,
                "granted_at": isoformat_or_none(granted_at),
                "expires_at": isoformat_or_none(expires_at),
                "redeem_started_at": isoformat_or_none(parse_datetime(credit.get("redeem_started_at"))),
                "redeemed_at": isoformat_or_none(parse_datetime(credit.get("redeemed_at"))),
                "title": credit.get("title"),
                "description": credit.get("description"),
            }
        )

    available = sorted(
        (credit for credit in normalized if credit["available"]),
        key=lambda credit: (credit["expires_at"] is None, credit["expires_at"] or "", credit["id"] or ""),
    )
    next_expiring = next((credit for credit in available if credit["expires_at"] is not None), None)

    return {
        "available_count": len(available),
        "reported_available_count": response.get("available_count"),
        "next_expires_at": next_expiring["expires_at"] if next_expiring else None,
        "credits": normalized,
    }


def isoformat_or_none(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def print_human_summary(summary: dict[str, Any], auth_path: Path) -> None:
    print(f"Auth: {auth_path}")
    print(f"Limit Reset Credits: {summary['available_count']} available")
    if summary["reported_available_count"] != summary["available_count"]:
        print(f"Reported available_count: {summary['reported_available_count']}")
    if summary["next_expires_at"]:
        print(f"Next reset credit expires: {summary['next_expires_at']}")
    else:
        print("Next reset credit expires: none")

    credits = summary["credits"]
    if not credits:
        return

    print()
    for index, credit in enumerate(credits, start=1):
        marker = "available" if credit["available"] else str(credit["status"] or "unknown")
        expiry = credit["expires_at"] or "no expiry"
        reset_type = credit["reset_type"] or "unknown"
        print(f"{index}. {marker} | {reset_type} | expires: {expiry}")


if __name__ == "__main__":
    raise SystemExit(main())
