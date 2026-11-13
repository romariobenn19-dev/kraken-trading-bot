# Movie Night - one-time Windows setup (called by setup.bat, runs as administrator).
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. Let Tailscale devices (her tablet) reach Movie Night. Nothing else gets in.
if (-not (Get-NetFirewallRule -DisplayName 'Movie Night' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Movie Night' -Direction Inbound -Protocol TCP -LocalPort 8080 `
    -Action Allow -RemoteAddress 100.64.0.0/10 | Out-Null
  Write-Host '  Firewall: added'
} else {
  Write-Host '  Firewall: already set up'
}

# 2. Desktop / Start menu shortcuts, and start with Windows.
& (Join-Path $dir 'setup-shortcuts.ps1')
Write-Host '  Desktop shortcut: Movie Night (also starts when Windows starts)'

# 3. Open it now - through Explorer so it runs as you, not as administrator.
$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Movie Night.lnk'
Start-Process explorer.exe -ArgumentList "`"$desktopLink`""
