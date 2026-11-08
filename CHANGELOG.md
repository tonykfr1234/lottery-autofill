# CHANGELOG

## 1.0.0 — 2026-11-08

首版：把原本寫死在 isafe 的流程，重構成「設定檔驅動」的通用作業器。

### 新增

- **零依賴 CDP 驅動**（`src/cdp.mjs`）：只用 Node 22 內建 `fetch` / `WebSocket`，不需要 npm install。
- **真實輸入層**（`src/human.mjs`）：`Input.dispatchMouseEvent` + `Input.insertText`，含移動／按壓／停留、捲動穩定、倒數、作答間隔抖動、原生 `<select>` 處理。
- **步驟引擎**（`src/flow.mjs`）：19 種動作（`goto`、`wait`、`waitVisible`、`until`、`click`、`clickText`、`type`、`select`、`answerByValue`、`answerByBank`、`scrollEnd`、`countdown`、`sleep`、`gap`、`eval`、`assert`、`shot`、`ocr`、`if`、`repeat`、`forCount`、`log`、`stop`），支援 `${...}` 變數插值與 `danger` 標記。
- **答案庫比對**（`src/answers.mjs`）：先比 `answerId`（選項洗牌也不怕），再比文字相似度；三種題庫格式都吃。
- **多帳號**（`src/store.mjs` + `src/mailbox.mjs`）：`accounts.json` 記錄每人已跑次數；信箱來源可選 Gmail `+` 別名、手動佇列、Cloudflare Email Routing API。
- **CLI**（`run.mjs`）：`doctor` / `probe` / `run` / `report` / `stop` / `teach` / `new-site`。
- **`--dry-run`**：跳過所有 `danger: true` 的寫入動作，可以先把整條流程走一遍。
- **`teach`**：把目前頁面的題組抓成 JSON 骨架，題目換了只要補答案。
- **一鍵安裝**：`install.ps1`（Windows，含桌面捷徑、舊 isafe 資料匯入）與 `install.sh`（macOS/Linux）。
- **內建站點** `sites/isafeevent.json`：全民數位素養自我評量，含 48 題答案庫。
- **文件**：`docs/SITE-RULES.md`（規則語法）、`docs/NEW-SITE.md`（15 分鐘接新站）、`docs/TROUBLESHOOTING.md`。

### 從舊版（`C:\deepseek_v2\isafe`）帶過來的實測經驗

- Turnstile 通過後送出鈕才會從 `d-none` 變可見 → 用 `waitVisible` 停等，而不是硬點。
- 真實點擊偶爾不觸發 SPA 的 handler → `click` 內建「verify 失敗就退回 `el.click()`」。
- 次數頁要滑到最底並停留 → `scrollEnd` 的 `dwellMs` 預設 5000。
- OCR 把 `o` 認成 `0` 會整串混字 → `ocr.py` 先做字元映射再過濾。
- Chrome 被多次重開會連環重啟 → `ensureChrome` 先驗埠、5 分鐘內不重開。
