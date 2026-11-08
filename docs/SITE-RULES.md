# 站點規則語法（sites/*.json）

一份站點 JSON = 這個站的「網址 + 元素位置 + 步驟」。程式只負責執行，不認得任何特定網站。

```json
{
  "id": "isafeevent",
  "name": "顯示用名稱",
  "baseUrl": "https://isafeevent.moe.edu.tw",
  "matchUrl": "isafeevent\\.moe\\.edu\\.tw",
  "goalPerAccount": 60,
  "gapSec": 150,
  "probe": { "waitForRe": "/exam|login/", "selectors": ["#email"], "groupSelector": "input.answer" },
  "login":    { "steps": [ ... ] },
  "signup":   { "steps": [ ... ] },
  "unit":     { "steps": [ ... ] },
  "progress": { "read": [ ... ], "var": "used" }
}
```

| 欄位 | 說明 |
|---|---|
| `matchUrl` | 正則字串。用來在眾多分頁中認出「這是本站的分頁」，不會去動你其他 tab |
| `goalPerAccount` | 每個帳號要做到幾次才換帳號 |
| `gapSec` | 兩輪之間的休息秒數（實際會再加 0～200ms 抖動） |
| `login.steps` | 登入流程。已是登入狀態時也要能安全跑完（用 `if` 包住） |
| `signup.steps` | 註冊流程。**整段刪掉就不會自動建帳號**，只會用 `data/accounts.json` 既有的 |
| `unit.steps` | 一次「機會」的完整動作（作答 → 送出 → 確認結果） |
| `progress.read` | 讀出目前已用次數；最後一個 `eval` 的 `save` 名稱要等於 `progress.var` |

## 變數

所有字串欄位都支援 `${...}` 插值：

| 變數 | 內容 |
|---|---|
| `${base}` | `baseUrl` |
| `${account.email}` `${account.password}` `${account.nickname}` | 當前帳號 |
| `${profile.xxx}` | `config.json` 的 `profile` 區塊（註冊表單固定值） |
| `${config.xxx}` | 整個設定檔 |
| `${captcha}` | `ocr` 動作存下來的驗證碼 |
| `${used}` `${i}` `${index}` `${rounds}` | 迴圈與進度 |
| `${now}` | `Date.now()` |

插值後的值若放進 `eval` / `assert`，就是一段 JS 表達式（例如 `"${p1} === 16"` → `"16 === 16"`）。

## 動作一覽

每個步驟是一個物件，`a`（或 `action`）指定動作。`"danger": true` 表示寫入類動作，`--dry-run` 會跳過。

| 動作 | 參數 | 作用 |
|---|---|---|
| `goto` | `url`、`waitFor`（字面子串）或 `waitForRe`（正則字串）、`timeoutMs` | 導航並等到 URL 符合 + `document.readyState === complete` |
| `wait` | `selector` 或 `waitFor`/`waitForRe`、`timeoutMs` | 等元素出現，或等 URL 變化 |
| `waitVisible` | `selector`、`timeoutMs` | 等元素**可見**（寬高 > 0、非 hidden）。常用於 Turnstile 通過後才出現的按鈕 |
| `until` | `cond`（JS 表達式）、`timeoutMs` | 等某個條件為真 |
| `click` | `selector`、`optional`、`dwellMs`、`verify`（JS 表達式） | 真實滑鼠點擊；`verify` 失敗會退回 DOM click 再確認一次 |
| `clickText` | `selector`、`text`、`exact`、`optional` | 在候選元素中找含指定文字的那個來點 |
| `type` | `selector`、`text`、`clear`、`mask` | 聚焦 → 全選 → 逐字輸入（含隨機延遲） |
| `select` | `selector`、`value` | 原生 `<select>`：先真實點一下，再設值並派發 `change` |
| `answerByValue` | `groupSelector`、`value` | 每組選項都選同一個 value（例：量表全選 5） |
| `answerByBank` | `groupSelector`、`bank`、`fallback` | 依答案庫比對作答。`fallback`: `fail`（預設）/`first`/`random` |
| `scrollEnd` | `dwellMs` | 滑到頁尾並停留（有些站要「看過」才算數） |
| `countdown` | `sec`、`label` | 送出前倒數，同時是給人看得懂的心跳 |
| `sleep` | `ms` | 純等待 |
| `gap` | `ms` | 題與題之間的間隔（預設 1 秒 + 抖動） |
| `eval` | `expr`、`save`、`expect`、`log` | 在頁面執行 JS；`save` 把結果存進變數 |
| `assert` | `expr`、`message` | 條件不成立就讓這一輪失敗（會記 log、換下一輪） |
| `shot` | `path`、`fullPage` | 截圖（路徑支援變數） |
| `ocr` | `imageSelector`、`file`、`save`、`mode`、`digitsOnly`、`timeoutMs` | 抓驗證碼圖 → OCR → 失敗則等人工寫入 `data/handoff-code.txt` |
| `if` | `cond`、`then`、`else` | 條件分支（`then`/`else` 都是步驟陣列） |
| `repeat` | `times`、`steps`、`gapMs` | 固定次數重複；迴圈內有 `${i}` |
| `forCount` | `watchExpr`、`target`、`max`、`steps`、`gapMs` | 邊做邊量直到達標（例如抽獎次數到 60） |
| `log` | `text` | 寫一行到 console 與 log |
| `stop` | — | 主動結束流程 |

## 選擇題自動作答

`answerByValue` / `answerByBank` 都會先把 `groupSelector` 命中的 input 依 `name`（或 `id`）分組，每組視為一題：

```js
group = {
  name: "answer_3",
  qid: "3",                 // 從 input id 的 `_` 後面取，取不到就用 name
  stem: "題幹文字…",         // 往上找容器、扣掉選項文字後剩下的字串
  options: [ { id, value, text } ]
}
```

`answerByBank` 的比對順序：

1. 答案庫有 `answerId` 且頁面上真有這個 id → 直接點（最精準，選項洗牌也不怕）
2. 用 `answerText` 跟選項文字比相似度（去空白與標點，前 18 字元前綴相同也算命中）
3. 都沒有 → 依 `fallback` 處理；預設讓這一輪失敗並記錄，不會亂猜

答案庫格式（三種都吃）：

```json
{
  "questions": {
    "3": { "stem": "題幹", "answerText": "正解文字", "answerId": "q_3_2" }
  }
}
```

```json
{ "byStem": [ { "stem": "題幹關鍵字", "answer": "正解文字" } ] }
```

```json
{ "3": "正解文字" }
```

## 實例：isafeevent 的「一輪」

```json
{ "a": "goto", "url": "${base}/exam/", "waitForRe": "/exam/", "timeoutMs": 40000 },
{ "a": "countdown", "sec": 5, "label": "按下「開始評量」" },
{ "a": "click", "selector": ".btnStartExam" },
{ "a": "wait", "waitForRe": "/exam/do2/[0-9a-f-]{36}/", "timeoutMs": 45000 },
{ "a": "answerByValue", "groupSelector": "input.answer", "value": "5" },
{ "a": "eval", "expr": "document.querySelectorAll('input.answer:checked').length", "save": "p1", "log": false },
{ "a": "assert", "expr": "${p1} === 16", "message": "第一頁沒有填滿 16 題" },
{ "a": "click", "selector": ".btnSendExam", "danger": true },
{ "a": "wait", "waitForRe": "/exam/do/", "timeoutMs": 45000 },
{ "a": "answerByBank", "groupSelector": "input.answer", "bank": "sites/isafeevent/answers.json" },
{ "a": "click", "selector": ".btnSendExam", "danger": true },
{ "a": "wait", "waitForRe": "/exam/result/", "timeoutMs": 45000 }
```

## 寫規則的三個原則

1. **每一步都要有可驗證的結果**：`goto` 之後用 `wait`/`assert` 確認真的到了，不要只按完就往下跑。
2. **寫入動作一律標 `danger`**：送出、註冊、兌換，這樣 `--dry-run` 才有意義。
3. **先 `probe` 再 `run`**：selector 打錯時 `probe` 會直接告訴你找到 0 個，不用等跑到一半才失敗。
