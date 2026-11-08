#!/usr/bin/env bash
# lottery-autofill 一鍵安裝（macOS / Linux）
#   bash install.sh
#   bash install.sh --import-from ~/isafe
#   curl -fsSL https://raw.githubusercontent.com/tonykfr1234/lottery-autofill/main/install.sh | bash
set -euo pipefail

REPO_URL="https://github.com/tonykfr1234/lottery-autofill"
BRANCH="main"
IMPORT_FROM=""
PORT=9333

while [ $# -gt 0 ]; do
  case "$1" in
    --import-from) IMPORT_FROM="$2"; shift 2 ;;
    --repo) REPO_URL="$2"; shift 2 ;;
    --branch) BRANCH="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    *) echo "未知參數：$1"; exit 1 ;;
  esac
done

say()  { printf '\033[36m[install]\033[0m %s\n' "$1"; }
warn() { printf '\033[33m[install]\033[0m %s\n' "$1"; }
die()  { printf '\033[31m[install]\033[0m %s\n' "$1"; exit 1; }

# ---------- 取得程式碼 ----------
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [ -f "$HERE/run.mjs" ]; then
  ROOT="$HERE"
  say "使用目前目錄：$ROOT"
else
  ROOT="$HOME/lottery-autofill"
  if [ -f "$ROOT/run.mjs" ]; then
    say "已存在：$ROOT"
  else
    say "下載 $REPO_URL ($BRANCH) → $ROOT"
    command -v git >/dev/null 2>&1 || die "需要 git 或先手動下載 repo"
    git clone --depth 1 -b "$BRANCH" "$REPO_URL.git" "$ROOT"
  fi
fi
cd "$ROOT"

# ---------- 檢查 Node ----------
command -v node >/dev/null 2>&1 || die "找不到 Node.js，請先安裝 22 以上（mac: brew install node / linux: nvm install 22）"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node.js $(node -v) 太舊，需要 22 以上"
say "Node.js $(node -v) OK"

if [ "$(uname)" = "Darwin" ]; then
  [ -d "/Applications/Google Chrome.app" ] || warn "找不到 Google Chrome（Turnstile 站台建議安裝）"
else
  command -v google-chrome >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1 || warn "找不到 Chrome/Chromium"
fi

# ---------- 設定檔 ----------
mkdir -p config data
if [ ! -f config/config.json ]; then
  cp config/config.example.json config/config.json
  warn "已建立 config/config.json，請改成自己的 profile / mailbox / password"
fi
node -e "
const fs=require('fs');
const f='config/config.json';
const j=JSON.parse(fs.readFileSync(f,'utf8'));
j.cdpPort=$PORT;
fs.writeFileSync(f, JSON.stringify(j,null,2));
console.log('[install] CDP 埠設為 $PORT');
"

# ---------- 匯入舊資料 ----------
if [ -n "$IMPORT_FROM" ] && [ -d "$IMPORT_FROM" ]; then
  if [ -f "$IMPORT_FROM/accounts.csv" ]; then
    node -e "
const fs=require('fs');
const src='$IMPORT_FROM/accounts.csv';
const lines=fs.readFileSync(src,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);
const head=lines.shift().split(',').map(s=>s.replace(/^\"|\"$/g,''));
const idx=n=>head.indexOf(n);
const out=[];
for (const l of lines) {
  const cells=l.match(/\"([^\"]*)\"|([^,]+)/g).map(c=>c.replace(/^\"|\"$/g,''));
  const email=cells[idx('email')]; if(!email) continue;
  out.push({email, nickname:cells[idx('nickname')]||'', password:cells[idx('password')]||'', used:0, target:60, site:'isafeevent'});
}
const dst='data/accounts.json';
let prev=[]; try{ prev=JSON.parse(fs.readFileSync(dst,'utf8')); }catch{}
const known=new Set(prev.map(a=>a.email));
fs.writeFileSync(dst, JSON.stringify(prev.concat(out.filter(a=>!known.has(a.email))),null,2));
console.log('[install] 匯入帳號 '+out.length+' 筆');
"
  fi
  [ -f "$IMPORT_FROM/kb.json" ] && cp "$IMPORT_FROM/kb.json" sites/isafeevent/answers.json && say "已匯入題庫"
fi

say "跑環境檢查…"
node run.mjs doctor || true

cat <<'EOF'

安裝完成。

下一步：
  1. 編輯 config/config.json（profile / mailboxes / defaults.password）
  2. node run.mjs probe --site isafeevent
  3. node run.mjs run   --site isafeevent --max 1 --dry-run
  4. node run.mjs run   --site isafeevent
  5. node run.mjs report      # 累積次數
     停止：node run.mjs stop

換新站：
  node run.mjs new-site 新站名 --url https://新站 --match 網域關鍵字
  再改 sites/新站名.json 的 selector 與 steps。
EOF
