# start.ps1 — 開始跑（Windows）
#   powershell -ExecutionPolicy Bypass -File start.ps1
#   powershell -File start.ps1 -Site isafeevent -Max 0 -DryRun
param(
  [string]$Site = '',
  [int]$Max = 0,
  [switch]$DryRun,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

$nodeArgs = @('run.mjs', 'run')
if ($Site) { $nodeArgs += @('--site', $Site) }
if ($Max -gt 0) { $nodeArgs += @('--max', "$Max") }
if ($DryRun) { $nodeArgs += '--dry-run' }

Write-Host '=== lottery-autofill 開始 ===' -ForegroundColor Cyan
Write-Host "目錄：$root"
Write-Host "指令：node $($nodeArgs -join ' ')" -ForegroundColor DarkGray
Write-Host '要停止：關掉這個視窗，或雙擊「抽獎-停止」/ node run.mjs stop' -ForegroundColor DarkGray
Write-Host ''

$logDir = Join-Path $root 'data'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("run-" + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.log')

& node @nodeArgs 2>&1 | Tee-Object -FilePath $logFile

Write-Host ''
Write-Host "結束，日誌：$logFile" -ForegroundColor Yellow
if (-not $NoPause) { Read-Host '按 Enter 關閉' | Out-Null }
