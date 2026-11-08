<#
.SYNOPSIS
  lottery-autofill 一鍵安裝（Windows）

.EXAMPLE
  # 在本目錄安裝
  powershell -ExecutionPolicy Bypass -File install.ps1

.EXAMPLE
  # 從 GitHub 一行安裝（會下載到 %USERPROFILE%\lottery-autofill）
  irm https://raw.githubusercontent.com/tonykfr1234/lottery-autofill/main/install.ps1 | iex

.EXAMPLE
  # 把舊 isafe 的帳號與題庫帶進來
  powershell -ExecutionPolicy Bypass -File install.ps1 -ImportFrom C:\deepseek_v2\isafe
#>
[CmdletBinding()]
param(
  [string]$ImportFrom = '',
  [string]$RepoUrl = 'https://github.com/tonykfr1234/lottery-autofill',
  [string]$Branch = 'main',
  [string]$InstallDir = '',
  [int]$Port = 9333,
  [switch]$NoShortcut,
  [switch]$SkipChecks
)

$ErrorActionPreference = 'Stop'
function Say($m, $c = 'Cyan') { Write-Host "[install] $m" -ForegroundColor $c }
function Fail($m) { Write-Host "[install] $m" -ForegroundColor Red; exit 1 }

# ---------- 1. 取得程式碼 ----------
$here = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }

if (Test-Path (Join-Path $here 'run.mjs')) {
  $root = $here
  Say "使用目前目錄：$root"
} else {
  if (-not $InstallDir) { $InstallDir = Join-Path $env:USERPROFILE 'lottery-autofill' }
  $root = $InstallDir
  if (Test-Path (Join-Path $root 'run.mjs')) {
    Say "已存在：$root（跳過下載）"
  } else {
    Say "下載 $RepoUrl ($Branch) → $root"
    $zip = Join-Path $env:TEMP ("lottery-autofill-" + [guid]::NewGuid().ToString('N') + '.zip')
    $url = "$RepoUrl/archive/refs/heads/$Branch.zip"
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
    } catch {
      Fail "下載失敗：$url`n$($_.Exception.Message)（私有 repo 請先 git clone 再在本目錄執行）"
    }
    $tmp = Join-Path $env:TEMP ("lottery-unzip-" + [guid]::NewGuid().ToString('N'))
    Expand-Archive -Path $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem $tmp -Directory | Select-Object -First 1
    if (-not $inner) { Fail "解壓後找不到目錄" }
    New-Item -ItemType Directory -Force -Path $root | Out-Null
    Copy-Item (Join-Path $inner.FullName '*') $root -Recurse -Force
    Remove-Item $zip, $tmp -Recurse -Force -ErrorAction SilentlyContinue
    Say "已安裝到 $root"
  }
}

Set-Location $root

# ---------- 2. 檢查 Node / Chrome ----------
if (-not $SkipChecks) {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Say '找不到 Node.js。' 'Yellow'
    Say '請先安裝（任一種）：' 'Yellow'
    Say '  winget install OpenJS.NodeJS.LTS' 'Yellow'
    Say '  或到 https://nodejs.org 下載 LTS（需要 22 以上）' 'Yellow'
    Fail '缺少 Node.js'
  }
  $major = [int]((& node -v).TrimStart('v').Split('.')[0])
  if ($major -lt 22) { Fail "Node.js $(& node -v) 太舊，需要 22 以上（本專案用到內建 WebSocket）" }
  Say "Node.js $(& node -v) OK"

  $chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
  ) | Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($chrome) { Say "Chrome OK：$chrome" }
  else { Say '找不到 Google Chrome（某些站的 Turnstile 需要真的 Chrome）' 'Yellow' }
}

# ---------- 3. 設定檔 ----------
$cfgDir = Join-Path $root 'config'
$cfg = Join-Path $cfgDir 'config.json'
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null
if (-not (Test-Path $cfg)) {
  Copy-Item (Join-Path $cfgDir 'config.example.json') $cfg
  Say "已建立 $cfg（請把 profile / mailboxes / password 改成自己的）" 'Yellow'
} else {
  Say "設定檔已存在：$cfg"
}

# 只覆寫 port，其他保留
try {
  $json = Get-Content $cfg -Raw | ConvertFrom-Json
  $json.cdpPort = $Port
  $json | ConvertTo-Json -Depth 12 | Set-Content $cfg -Encoding UTF8
  Say "CDP 埠設為 $Port"
} catch {
  Say "設定檔解析失敗，稍後請手動檢查：$cfg" 'Yellow'
}

# ---------- 4. 匯入舊資料 ----------
if ($ImportFrom) {
  if (-not (Test-Path $ImportFrom)) { Say "找不到 $ImportFrom，跳過匯入" 'Yellow' }
  else {
    $dataDir = Join-Path $root 'data'
    New-Item -ItemType Directory -Force -Path $dataDir | Out-Null

    $csv = Join-Path $ImportFrom 'accounts.csv'
    if (Test-Path $csv) {
      $rows = Import-Csv $csv
      $out = @()
      $existingFile = Join-Path $dataDir 'accounts.json'
      if (Test-Path $existingFile) { $out = @(Get-Content $existingFile -Raw | ConvertFrom-Json) }
      $known = @{}
      foreach ($r in $out) { $known[$r.email] = $true }
      foreach ($r in $rows) {
        if (-not $r.email -or $known.ContainsKey($r.email)) { continue }
        $out += [pscustomobject]@{
          email      = $r.email
          nickname   = $r.nickname
          password   = $r.password
          used       = 0
          target     = 60
          site       = 'isafeevent'
          importedAt = (Get-Date).ToString('o')
        }
      }
      $out | ConvertTo-Json -Depth 8 | Set-Content $existingFile -Encoding UTF8
      Say "已匯入 $($rows.Count) 筆帳號 → $existingFile"
    }

    $kb = Join-Path $ImportFrom 'kb.json'
    $target = Join-Path $root 'sites\isafeevent\answers.json'
    if (Test-Path $kb) {
      Copy-Item $kb $target -Force
      Say "已匯入題庫 → $target"
    }
  }
}

# ---------- 5. 桌面捷徑 ----------
if (-not $NoShortcut) {
  $desktop = [Environment]::GetFolderPath('Desktop')
  $startVbs = Join-Path $desktop '抽獎-開始.vbs'
  $stopVbs = Join-Path $desktop '抽獎-停止.vbs'
  $startPs1 = Join-Path $root 'start.ps1'
  $stopPs1 = Join-Path $root 'stop.ps1'
  if (Test-Path $startPs1) {
    $line = 'CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""' + $startPs1 + '""", 1, False'
    Set-Content -Path $startVbs -Value $line -Encoding ASCII
    $line2 = 'CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""' + $stopPs1 + '""", 1, False'
    Set-Content -Path $stopVbs -Value $line2 -Encoding ASCII
    Say "桌面捷徑已建立：抽獎-開始.vbs / 抽獎-停止.vbs"
  }
}

# ---------- 6. 自我檢查 ----------
Say '跑環境檢查…'
try {
  & node run.mjs doctor
} catch {
  Say '檢查未完成，可稍後手動執行：node run.mjs doctor' 'Yellow'
}

Write-Host ''
Say '安裝完成。' 'Green'
Say "目錄：$root"
Write-Host @"
下一步：
  1. 編輯 config\config.json（profile 表單值 / mailboxes 信箱 / defaults.password）
  2. node run.mjs probe --site isafeevent     # 確認連得到、選擇器找得到
  3. node run.mjs run   --site isafeevent --max 1 --dry-run   # 演練，不真的送出
  4. node run.mjs run   --site isafeevent     # 正式跑
  5. node run.mjs report                      # 看累積次數
  停止：node run.mjs stop  或雙擊桌面「抽獎-停止」

換新站（以後有別的抽獎）：
  node run.mjs new-site 新站名 --url https://新站網址 --match 網域關鍵字
  然後改 sites\新站名.json 裡的 selector 與 steps，其餘不動。
"@ -ForegroundColor Gray
