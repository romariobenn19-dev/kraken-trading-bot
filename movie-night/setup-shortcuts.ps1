# Movie Night - (re)create the shortcuts. No administrator rights needed.
# Desktop + Start menu: open Movie Night. Startup: start it when Windows starts.
# They run start-movie-night.bat in a minimised window (closing that window stops Movie Night).
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$bat = Join-Path $dir 'start-movie-night.bat'
$icon = Join-Path $dir 'public\icon.ico'

# Files from a downloaded ZIP are flagged 'from the internet'; clear that so Windows doesn't warn every time.
Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue

$ws = New-Object -ComObject WScript.Shell
function Make-Shortcut($path, $arguments) {
  $s = $ws.CreateShortcut($path)
  $s.TargetPath = $bat
  $s.Arguments = $arguments
  $s.WorkingDirectory = $dir
  $s.WindowStyle = 7   # minimised
  if (Test-Path $icon) { $s.IconLocation = $icon }
  $s.Description = 'Movie Night'
  $s.Save()
}

Make-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Movie Night.lnk') '--open'
Make-Shortcut (Join-Path ([Environment]::GetFolderPath('Programs')) 'Movie Night.lnk') '--open'
$startupDir = [Environment]::GetFolderPath('Startup')
Remove-Item (Join-Path $startupDir 'Movie Night (background).lnk') -ErrorAction SilentlyContinue
Make-Shortcut (Join-Path $startupDir 'Movie Night.lnk') '--background'
exit 0
