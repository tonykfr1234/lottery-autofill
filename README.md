# lottery-autofill

設定檔驅動的「抽獎／評量」自動化作業器。用 Chrome DevTools Protocol 直接操作你真實的 Chrome，
**換一個站只要換一份 JSON（網址 + selector + 步驟），程式不用改**。

內建一個完整可跑的站點範例：教育部「全民數位素養自我評量」（`sites/isafeevent.json`）。

- 零 npm 依賴（Node 22+ 內建 `fetch` / `WebSocket`）
- 真實滑鼠與鍵盤事件（`Input.dispatchMouseEvent` / `Input.insertText`），不是 `el.click()`
- 每個動作後停留、作答間隔、送出前倒數都可調
- 驗證碼：`ddddocr` 自動辨識，失敗自動退回人工輸入（寫一個檔案就好）
- 多帳號輪替、自動建信箱（Gmail `+` 別名 / 手動佇列 / Cloudflare Email Routing）
- `--dry-run` 演練模式：所有標了 `danger` 的寫入動作都會跳過
- 進度、錯誤、截圖全部落地成檔案，斷掉可以接著跑

---

## 一鍵安裝

### Windows

```powershell
irm https://raw.githubusercontent.com/tonykfr1234/lottery-autofill/main/install.ps1 | iex
```

或先把 repo 抓下來，在本目錄執行：

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
# 想把舊 isafe 的帳號與題庫一起帶進來：
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ImportFrom C:\deepseek_v2\isafe
```

安裝程式會：檢查 Node ≥ 22 與 Chrome → 建立 `config/config.json` → 建立桌面「抽獎-開始 / 抽獎-停止」捷徑 → 跑 `doctor`。

### macOS / Linux

```bash
git clone https://github.com/tonykfr1234/lottery-autofill.git
cd lottery-autofill
bash install.sh
# 或
bash install.sh --import-from ~/isafe
```

---

## 四步開始跑

```powershell
# 1. 改設定（表單固定值、信箱、密碼）
notepad config\config.json

# 2. 確認連得到、selector 找得到
node run.mjs probe --site isafeevent

# 3. 演練一輪（不送出任何寫入動作）
node run.mjs run --site isafeevent --max 1 --dry-run

# 4. 正式跑
node run.mjs run --site isafeevent

# 隨時看進度 / 停止
node run.mjs report
node run.mjs stop
```

---

## 指令

| 指令 | 作用 |
|---|---|
| `node run.mjs doctor` | 檢查 Node / Chrome / CDP / 設定 / 站點連線 / 答案庫 |
| `node run.mjs probe --site <id>` | 打開站點，回報每個 probe selector 找到幾個、題目群組幾組 |
| `node run.mjs run --site <id>` | 主流程：登入 → 註冊（需要時）→ 一輪一輪跑到目標次數 |
| `node run.mjs run --site <id> --max 3 --dry-run` | 只跑 3 輪、跳過所有 `danger` 動作 |
| `node run.mjs report` | 帳號數、達標數、累積次數、心跳、最近 5 個帳號 |
| `node run.mjs stop` | 寫 `data/stop.flag`，流程在下一步停止 |
| `node run.mjs teach --site <id>` | 把目前頁面的題目與選項抓成 JSON，方便你補答案 |
| `node run.mjs new-site <name> --url <url> --match <host>` | 從模板生出新站點設定 |

常用參數：`--config <path>`、`--site <id>`、`--port <9333>`、`--max <n>`、`--gap <秒>`、`--goal <次數>`、`--dry-run`、`--no-chrome`。

---

## 換站（以後有別的抽獎）

```powershell
node run.mjs new-site momo-lottery --url https://www.momoshop.com.tw --match momoshop
# 產生 sites/momo-lottery.json，把 URL / selector / steps 改成該站實際元素
node run.mjs probe --site momo-lottery
node run.mjs run   --site momo-lottery --max 1 --dry-run
```

站點 JSON 的完整語法（19 種動作、變數、if/repeat/forCount）：[docs/SITE-RULES.md](docs/SITE-RULES.md)
15 分鐘接一個新站的實作流程：[docs/NEW-SITE.md](docs/NEW-SITE.md)

---

## 目錄

```
run.mjs                     CLI 入口（doctor/probe/run/report/stop/teach/new-site）
src/
  cdp.mjs                   零依賴 CDP 驅動（連線、evaluate、滑鼠、截圖）
  human.mjs                 真實滑鼠／鍵盤、停頓、下拉選單、倒數
  actions.mjs               選擇題自動作答、題組抽取、驗證碼截圖與 OCR
  answers.mjs               答案庫載入與比對（answerId 優先，其次文字相似度）
  flow.mjs                  步驟引擎（站點規則的直譯器）
  mailbox.mjs               新信箱來源（plusAlias / manual / cloudflare）
  store.mjs                 帳號、進度、狀態、stop flag
sites/
  isafeevent.json           現成站點：全民數位素養自我評量
  isafeevent/answers.json   48 題答案庫（qid + answerText + answerId）
  _template.json            新站模板（附註解說明每一步該改什麼）
config/
  config.example.json       設定範本（個人表單值、信箱、密碼、節奏）
scripts/ocr.py              ddddocr 多變體投票（沒裝就退回人工輸入）
docs/                       規則語法、新站流程、故障排除
install.ps1 / install.sh    一鍵安裝
start.ps1 / stop.ps1        開始 / 停止（桌面捷徑指到這兩個）
```

執行後會產生（不進版控）：

```
config/config.json          你的個人設定
data/profile/               Chrome 專屬 profile（保存登入態）
data/accounts.json          帳號與各自已跑次數
data/progress.json          當前帳號與進度
data/run.jsonl              每輪結果（成功/失敗/錯誤訊息）
data/status.txt             心跳（給 watchdog 或你看）
data/stop.flag              停止旗標
data/shots/                 每輪結果頁截圖
data/handoff-code.txt       驗證碼需人工輸入時，把答案寫在這裡
```

---

## 內建站點：全民數位素養自我評量

| 項目 | 值 |
|---|---|
| 首頁 | https://isafeevent.moe.edu.tw |
| 登入 | `/login/`（`#email`、`#passowrd`、`#id_captcha_1`、`#form1 button[type=submit]`） |
| 註冊 | `/signin/`（Turnstile 通過後 `#submit-btn` 才會出現） |
| 一輪 | `/exam/` → `.btnStartExam` → `/exam/do2/<uuid>/`（16 題量表，全選 value=5）→ `.btnSendExam` → `/exam/do/`（16 題技能題，查答案庫）→ `/exam/result/` |
| 次數 | `/exam/records/` 的 `table tbody tr` 列數，上限 60 |
| 答案庫 | `sites/isafeevent/answers.json`（48 題，29 題帶 `answerId`） |

---

## 注意

- `data/`、`config/config.json` 已在 `.gitignore`：帳號、密碼、profile 不會被推上 GitHub。
- `--dry-run` 只跳過標了 `"danger": true` 的步驟（送出、註冊）。純導航與作答照跑，適合先確認 selector 正確。
- 同一時間只會有一個 Chrome 帶同一個 CDP 埠；`ensureChrome` 會先驗埠再用，不會重複開、也不會亂殺。
- 驗證碼若 OCR 失敗，流程會停下來等你：把辨識結果寫進 `data/handoff-code.txt`（一行），它會自己繼續。

## License

MIT
