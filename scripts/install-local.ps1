# One-time (or update) install: build if needed, copy to AppData, create shortcuts.
# Double-click "Install LeetCode SR.bat" or "Update LeetCode SR.bat" in the repo root.

param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$InstallDir = Join-Path $env:LOCALAPPDATA 'LeetCode-SR'
$ExeName = 'LeetCode - Spaced Repetition.exe'
$SourceDir = Join-Path $RepoRoot 'release\win-unpacked'
$ExePath = Join-Path $InstallDir $ExeName

function Stop-LeetCodeSr {
  $procs = Get-Process -Name 'LeetCode - Spaced Repetition' -ErrorAction SilentlyContinue
  if (-not $procs) { return }

  Write-Host 'Closing LeetCode SR (save work first)...'
  $procs | ForEach-Object { $_.CloseMainWindow() | Out-Null }
  Start-Sleep -Seconds 3

  $still = Get-Process -Name 'LeetCode - Spaced Repetition' -ErrorAction SilentlyContinue
  if ($still) {
    Write-Host 'Force-closing LeetCode SR...'
    $still | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
}

Set-Location $RepoRoot
Stop-LeetCodeSr

if (-not $SkipBuild) {
  Write-Host 'Building app...'
  npm run dist
}

if (-not (Test-Path (Join-Path $SourceDir $ExeName))) {
  throw "Build output not found: $SourceDir\$ExeName (run without -SkipBuild)"
}

Write-Host "Installing to $InstallDir ..."
if (Test-Path $InstallDir) {
  Remove-Item -Recurse -Force $InstallDir
}
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item -Path (Join-Path $SourceDir '*') -Destination $InstallDir -Recurse -Force

# Skip GitHub auto-update for this local-dev install (use Update LeetCode SR.bat instead).
Set-Content -Path (Join-Path $InstallDir '.local-dev-install') -Value (Get-Date -Format o)

function New-AppShortcut($LinkPath) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($LinkPath)
  $link.TargetPath = $ExePath
  $link.WorkingDirectory = $InstallDir
  $link.IconLocation = "$ExePath,0"
  $link.Description = 'LeetCode spaced repetition (local install)'
  $link.Save()
}

$Desktop = [Environment]::GetFolderPath('Desktop')
New-AppShortcut (Join-Path $Desktop 'LeetCode SR.lnk')

$StartMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
New-AppShortcut (Join-Path $StartMenu 'LeetCode SR.lnk')

Write-Host ''
Write-Host 'Done. Launch from:'
Write-Host "  Desktop shortcut: LeetCode SR"
Write-Host "  Or: $ExePath"
Write-Host ''
Write-Host 'Your progress stays in %APPDATA%\leetcode-sr\ (unchanged by reinstall).'
