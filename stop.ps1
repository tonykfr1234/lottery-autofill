# stop.ps1 — 停下來（Windows）
# 寫入 data/stop.flag，執行中的流程會在下一步結束；再等 2 秒後一併收掉 node 子行程。
$ErrorActionPreference = 'SilentlyContinue'
$root = $PSScriptRoot
Set-Location $root

Write-Host '=== lottery-autofill 停止 ===' -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path (Join-Path $root 'data') | Out-Null
& node run.mjs stop

Start-Sleep -Seconds 2

# 收掉還在跑的 run.mjs（只殺本目錄啟動的，避免誤殺其他 node）
$procs = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like "*$root*run.mjs*" }
if ($procs) {
  foreach ($p in $procs) {
    Write-Host "結束 node PID $($p.ProcessId)" -ForegroundColor Yellow
    Stop-Process -Id $p.ProcessId -Force
  }
} else {
  Write-Host '沒有殘留的 run.mjs 行程' -ForegroundColor DarkGray
}

Write-Host '已停止。' -ForegroundColor Green
Start-Sleep -Seconds 1
