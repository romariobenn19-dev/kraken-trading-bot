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

# 2. Desktop shortcut + start automatically when Windows starts.
$ws = New-Object -ComObject WScript.Shell
$vbs = Join-Path $dir 'launch.vbs'
$icon = Join-Path $dir 'public\icon.ico'
$wscript = Join-Path $env:WINDIR 'System32\wscript.exe'

function Make-Shortcut($path, $mode) {
  $s = $ws.CreateShortcut($path)
  $s.TargetPath = $wscript
  $s.Arguments = "`"$vbs`" $mode"
  $s.WorkingDirectory = $dir
  if (Test-Path $icon) { $s.IconLocation = $icon }
  $s.Description = 'Movie Night'
  $s.Save()
}

$desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Movie Night.lnk'
Make-Shortcut $desktopLink '--open'
Write-Host '  Desktop shortcut: Movie Night'

$startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Movie Night.lnk'
Make-Shortcut $startMenu '--open'

$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Movie Night (background).lnk'
Make-Shortcut $startup '--background'
Write-Host '  Starts automatically when Windows starts'

# 3. Open it now - through Explorer so it runs as you, not as administrator.
Start-Process explorer.exe -ArgumentList "`"$desktopLink`""
