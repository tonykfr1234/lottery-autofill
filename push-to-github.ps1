<#
.SYNOPSIS
  把本目錄推上 GitHub（先建 repo、再 push）。

.DESCRIPTION
  認證優先順序：
    1. -Token 參數
    2. 環境變數 $env:GH_TOKEN / $env:GITHUB_TOKEN
    3. 已登入的 gh CLI（gh auth status 通過）
    4. 已存在的 git 憑證（Windows 認證管理員 / .git-credentials）

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\push-to-github.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\push-to-github.ps1 -Token ghp_xxx

.EXAMPLE
  $env:GH_TOKEN = "ghp_xxx"; .\push-to-github.ps1 -Repo lottery-autofill -Visibility public
#>
[CmdletBinding()]
param(
  [string]$Owner = 'tonykfr1234',
  [string]$Repo = 'lottery-autofill',
  [ValidateSet('public', 'private')][string]$Visibility = 'public',
  [string]$Token = '',
  [string]$Message = '',
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
function Say($m, $c = 'Cyan') { Write-Host "[push] $m" -ForegroundColor $c }
function Die($m) { Write-Host "[push] $m" -ForegroundColor Red; exit 1 }

$root = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
Set-Location $root
Say "目錄：$root"

# ---------- 1. git 與 repo ----------
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die '找不到 git，請先安裝 Git for Windows' }

if (-not (Test-Path (Join-Path $root '.git'))) {
  Say '初始化 git repo…'
  git init -b main | Out-Null
} else {
  $branch = (git rev-parse --abbrev-ref HEAD).Trim()
  if ($branch -ne 'main') { Say "目前分支 $branch（push 時會用 main）" 'Yellow' }
}

if (-not (git config user.name)) { git config user.name 'tonykfr1234' }
if (-not (git config user.email)) { git config user.email 'tonykfr1234@users.noreply.github.com' }

# ---------- 2. commit ----------
git add -A
$dirty = (git status --porcelain) -ne $null -and (git status --porcelain).Trim() -ne ''
if ($dirty) {
  if (-not $Message) { $Message = 'lottery-autofill: 設定檔驅動的抽獎自動化作業器 v1.0.0' }
  Say "commit：$Message"
  git commit -m $Message | Out-Null
} else {
  Say '沒有新變更（工作區乾淨）'
}

$hasCommit = $true
git rev-parse --verify HEAD 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { $hasCommit = $false }
if (-not $hasCommit) { Die '沒有任何 commit，先確認檔案存在' }

# ---------- 3. 認證 ----------
if (-not $Token) {
  if ($env:GH_TOKEN) { $Token = $env:GH_TOKEN }
  elseif ($env:GITHUB_TOKEN) { $Token = $env:GITHUB_TOKEN }
}

$ghOk = $false
if (Get-Command gh -ErrorAction SilentlyContinue) {
  gh auth status 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $ghOk = $true }
}

if (-not $Token -and -not $ghOk) {
  Say '沒有可用的 GitHub 認證。' 'Yellow'
  Say '選一種方式後重跑這支腳本：' 'Yellow'
  Say '  A) gh auth login' 'Yellow'
  Say '  B) $env:GH_TOKEN = "ghp_你的_PAT"; .\push-to-github.ps1' 'Yellow'
  Say '  C) .\push-to-github.ps1 -Token ghp_你的_PAT' 'Yellow'
  Say '（PAT 需要 repo 權限；到 https://github.com/settings/tokens 建立）' 'Gray'
  exit 2
}

if ($Token) {
  $env:GH_TOKEN = $Token
  $env:GITHUB_TOKEN = $Token
}

# ---------- 4. 建 repo（必要時） ----------
$remote = "https://github.com/$Owner/$Repo.git"
$exists = $false
try {
  $r = Invoke-RestMethod -Uri "https://api.github.com/repos/$Owner/$Repo" -Headers @{ 'User-Agent' = 'lottery-autofill' } -ErrorAction Stop
  $exists = $true
  Say "repo 已存在：$($r.html_url)"
} catch {
  $exists = $false
}

if (-not $exists) {
  Say "建立 repo $Owner/$Repo（$Visibility）…"
  if ($ghOk -and -not $Token) {
    gh repo create "$Owner/$Repo" "--$Visibility" --description '設定檔驅動的抽獎／評量自動化作業器' 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0 -and -not $Force) { Say 'gh repo create 失敗，改用 API' 'Yellow' }
  }
  if (-not (Test-Path variable:r) -or -not $exists) {
    try {
      $body = @{
        name        = $Repo
        description = '設定檔驅動的抽獎／評量自動化作業器'
        private     = ($Visibility -eq 'private')
        has_issues  = $true
      } | ConvertTo-Json
      Invoke-RestMethod -Method Post -Uri 'https://api.github.com/user/repos' `
        -Headers @{ Authorization = "token $Token"; 'User-Agent' = 'lottery-autofill' } `
        -Body $body -ContentType 'application/json' | Out-Null
      Say 'repo 已建立（API）'
    } catch {
      $msg = $_.Exception.Message
      if ($msg -match '422') { Say 'repo 已存在（422），直接 push' 'Yellow' }
      else { Die "建立 repo 失敗：$msg" }
    }
  }
}

# ---------- 5. push ----------
$existingRemote = git remote
if ($existingRemote -notcontains 'origin') {
  git remote add origin $remote
} else {
  git remote set-url origin $remote
}

$pushUrl = $remote
if ($Token) {
  $pushUrl = "https://x-access-token:$Token@github.com/$Owner/$Repo.git"
}

Say 'push 中…'
$out = git push -u $pushUrl main 2>&1
$code = $LASTEXITCODE
if ($code -ne 0) {
  $out | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
  if (($out -join "`n") -match 'rejected|non-fast-forward') {
    Say '遠端已有內容且無法 fast-forward。要覆蓋請加 -Force：' 'Yellow'
    Say '  .\push-to-github.ps1 -Force' 'Yellow'
    if ($Force) {
      Say '強制推送…' 'Yellow'
      git push -u --force $pushUrl main
    } else { exit 1 }
  } else {
    Die 'push 失敗（看上面訊息）'
  }
} else {
  $out | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
}

# ---------- 6. 收尾 ----------
$page = "https://github.com/$Owner/$Repo"
$raw = "https://raw.githubusercontent.com/$Owner/$Repo/main/install.ps1"

Write-Host ''
Say '完成。' 'Green'
Write-Host "  Repo      : $page"
Write-Host "  一行安裝  : irm $raw | iex"
Write-Host "  Clone     : git clone $remote"
Write-Host ''
Say '提醒：config/config.json 與 data/ 已被 .gitignore 排除（帳號密碼不會上傳）。' 'Gray'
