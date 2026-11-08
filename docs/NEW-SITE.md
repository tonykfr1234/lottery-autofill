# 15 分鐘接一個新站

目標：不改任何 `.mjs`，只寫一份 `sites/<name>.json`。

## 0. 先看清楚流程（3 分鐘）

1. 用平常的 Chrome（不是自動化那個 profile）把流程手動走一遍：
   登入 → 進入活動 → 作答/點擊 → 送出 → 哪裡看得到「已獲得幾次」
2. 打開 DevTools（F12）→ Elements，把**每一步會點到的元素**記下來 selector。
   優先順序：`#id` > `[name=...]` > `[data-*]` > class（class 最容易因改版失效）。
3. 記下「次數」出現的位置（表格列數？某個數字 `<span>`？），這決定 `progress` 怎麼寫。

## 1. 建檔（30 秒）

```powershell
node run.mjs new-site mysite --url https://example.com/activity --match example.com
```

會產生 `sites/mysite.json`，內容是 `_template.json` 的複製，含每段該改什麼的註解。

## 2. 改 baseUrl / matchUrl（30 秒）

```json
"baseUrl": "https://example.com",
"matchUrl": "example\\.com"
```

`matchUrl` 用於認出「這是本站的分頁」。網域含點要跳脫（`\.`）。

## 3. 確認連得到（1 分鐘）

```powershell
node run.mjs probe --site mysite
```

它會開站、印出 title、每個 `probe.selectors` 找到幾個。都 ≥1 才往下。

## 4. 寫 login（3 分鐘）

關鍵技巧：**先 goto 一個「登入後才看得到」的頁面**，再看有沒有被導去登入頁。

```json
"login": {
  "steps": [
    { "a": "goto", "url": "${base}/member", "waitForRe": "/(member|login)/" },
    { "a": "eval", "expr": "location.href.includes('/login')", "save": "needLogin", "log": false },
    { "a": "if", "cond": "${needLogin}", "then": [
      { "a": "type", "selector": "#account", "text": "${account.email}" },
      { "a": "type", "selector": "#password", "text": "${account.password}", "mask": true },
      { "a": "click", "selector": "button[type=submit]", "danger": true },
      { "a": "wait", "waitForRe": "/member/", "timeoutMs": 25000 },
      { "a": "eval", "expr": "location.href.includes('/login')", "save": "loginFailed", "log": false },
      { "a": "assert", "expr": "!${loginFailed}", "message": "登入失敗" }
    ]}
  ]
}
```

有驗證碼就插一段 `ocr`：

```json
{ "a": "ocr", "imageSelector": "#captchaImg", "file": "data/captcha/login.png", "save": "captcha", "digitsOnly": true },
{ "a": "type", "selector": "#captchaInput", "text": "${captcha}" }
```

沒有註冊流程 → 把整個 `signup` 區塊刪掉，改用 `data/accounts.json` 手動放帳號：

```json
[{ "email": "a@b.com", "password": "xxx", "nickname": "小名", "used": 0, "target": 10 }]
```

## 5. 寫 unit（5 分鐘）

一次機會 = 一段 steps。三個習慣：

```json
"unit": { "steps": [
  { "a": "goto", "url": "${base}/activity", "waitForRe": "/activity/" },
  { "a": "clickText", "selector": "button,a", "text": "開始作答" },
  { "a": "answerByValue", "groupSelector": "input[type=radio]", "value": "5" },
  { "a": "eval", "expr": "document.querySelectorAll('input[type=radio]:checked').length", "save": "n", "log": false },
  { "a": "assert", "expr": "${n} > 0", "message": "一題都沒選到" },
  { "a": "countdown", "sec": 3, "label": "送出" },
  { "a": "click", "selector": "button.submit", "danger": true },
  { "a": "wait", "waitForRe": "/result/", "timeoutMs": 30000 },
  { "a": "shot", "path": "data/shots/${account.email}-${rounds}.png" }
]}
```

- 每段結束都要有 `wait` 或 `assert` 確認真的成功
- 送出類按鈕標 `"danger": true`
- 加一張 `shot`，出問題時直接看圖

## 6. 寫 progress（2 分鐘）

```json
"progress": {
  "read": [
    { "a": "goto", "url": "${base}/records", "waitForRe": "/records/" },
    { "a": "scrollEnd", "dwellMs": 2000 },
    { "a": "eval", "expr": "document.querySelectorAll('table tbody tr').length", "save": "used", "log": false }
  ],
  "var": "used"
}
```

如果是文字裡的數字：

```json
{ "a": "eval", "expr": "parseInt((document.body.innerText.match(/已獲得\\s*(\\d+)\\s*次/)||[0,0])[1],10)", "save": "used", "log": false }
```

## 7. 演練再上線

```powershell
node run.mjs run --site mysite --max 1 --dry-run   # 不送出，確認流程走得完
node run.mjs run --site mysite --max 1             # 真的跑一輪
node run.mjs report
```

## 8. 題目會換？用 teach 補答案庫

```powershell
# 手動把瀏覽器停在題目頁
node run.mjs teach --site mysite --out data/answers.capture.json
```

它會把題幹與選項抓成 JSON，你把每題的 `answerText` 填上正解文字即可。
之後 `unit` 裡把 `answerByValue` 換成：

```json
{ "a": "answerByBank", "groupSelector": "input[type=radio]", "bank": "data/answers.capture.json", "fallback": "fail" }
```

## 常見卡點

| 症狀 | 原因 | 解法 |
|---|---|---|
| `probe` 找到 0 個 | selector 錯、或在 iframe 裡 | DevTools 複製 selector 時確認沒有 `#document`；iframe 內容要用 `eval` 進去抓 |
| `wait` 逾時，但畫面明明到了 | SPA 換頁不改 URL | 改用 `waitVisible` 等某個元素 |
| 點到了但沒反應 | 元素被遮罩或需要 hover | 加 `"verify"`，失敗時會退回 DOM click；或先 `click` 遮罩層 |
| 送出後被判斷機器人 | 動作太快 | 調 `config.human` 的 `dwellMs` / `answerGapMs`，並保留 `countdown` |
| 驗證碼一直錯 | ddddocr 沒裝 | `pip install ddddocr pillow`，或讓它退回人工輸入 |
