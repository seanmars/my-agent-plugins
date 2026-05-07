<#
.SYNOPSIS
    Register (or remove) the AppUserModelID used by the notifier plugin
    so Windows toasts show "Claude Code" instead of the default
    "Microsoft.Windows.Shell.RunDialog" / localized "執行".

.PARAMETER AppId
    The AUMID to register. Must match CLAUDE_NOTIFY_APP_ID / the default
    in notify.cs. Default: ClaudeCode.Notifier

.PARAMETER DisplayName
    The label Windows shows on the toast header. Default: Claude Code

.PARAMETER Uninstall
    Remove the registered AUMID instead of installing it.

.EXAMPLE
    .\install.ps1
    .\install.ps1 -DisplayName "Claude"
    .\install.ps1 -Uninstall
#>

[CmdletBinding()]
param(
    [string]$AppId = "ClaudeCode.Notifier",
    [string]$DisplayName = "Claude Code",
    [switch]$Uninstall
)

$ErrorActionPreference = "Stop"
$keyPath = "HKCU:\Software\Classes\AppUserModelId\$AppId"

if ($Uninstall) {
    if (Test-Path $keyPath) {
        Remove-Item -Path $keyPath -Recurse -Force
        Write-Host "Removed AUMID: $AppId" -ForegroundColor Yellow
    } else {
        Write-Host "AUMID not registered, nothing to remove: $AppId" -ForegroundColor DarkGray
    }
    return
}

# app.ico is optional; only register IconUri when the file actually exists.
$iconPath = Join-Path $PSScriptRoot "app.ico"

New-Item -Path $keyPath -Force | Out-Null
New-ItemProperty -Path $keyPath -Name "DisplayName" -Value $DisplayName -PropertyType String -Force | Out-Null

if (Test-Path $iconPath) {
    New-ItemProperty -Path $keyPath -Name "IconUri" -Value $iconPath -PropertyType String -Force | Out-Null
    Write-Host "Registered AUMID: $AppId" -ForegroundColor Green
    Write-Host "  DisplayName: $DisplayName"
    Write-Host "  IconUri    : $iconPath"
} else {
    # Strip any stale IconUri from a previous run so we don't keep pointing
    # at a file the user has since deleted.
    Remove-ItemProperty -Path $keyPath -Name "IconUri" -ErrorAction SilentlyContinue
    Write-Host "Registered AUMID: $AppId" -ForegroundColor Green
    Write-Host "  DisplayName: $DisplayName"
    Write-Host "  IconUri    : (skipped - app.ico not found at $iconPath)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Trigger any Claude Code hook to verify the new toast header." -ForegroundColor Cyan
