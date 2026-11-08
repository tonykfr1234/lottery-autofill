# 故障排除

全部是實測過的症狀。先跑 `node run.mjs doctor`，多數問題它會直接指出來。

## Chrome / CDP

| 症狀 | 原因 | 處理 |
|---|---|---|
| `Chrome 啟動後 30 秒內沒有開放 CDP 埠` | Chrome 路徑不對，或已有 Chrome 用同一個 profile 在跑 | 確認 `config.chromePath`；把 `data/profile` 裡的 `SingletonLock` 刪掉再試 |
| `CDP 逾時` 一直出現 | 頁面在做長輪詢或跳 alert | 通常重跑就好；持續發生就把 `timeoutMs` 調大 |
| 自動化開的 Chrome 一直搶走焦點、打字被切掉 | 視窗被帶到前景 | 不要用 `Page.bringToFront`；本專案只用 `window.focus()`，若仍搶焦點請確認沒有別的腳本在 bringToFront |
| 跑一跑 Chrome 自己關掉 | 記憶體不足或 crash | 看 `data/run-*.log`；必要時 `--no-chrome` 自己開好 Chrome 再讓它接 |
| 埠被佔用 | 上一個實例沒收乾淨 | `Get-NetTCPConnection -LocalPort 9333` 找 PID 後 `Stop-Process`；或在 `config.json` 改 `cdpPort` |

## 登入 / 驗證碼

| 症狀 | 原因 | 處理 |
|---|---|---|
| `登入失敗：帳號、密碼或驗證碼錯誤` 連 3 次 | 密碼錯、或 OCR 連續判錯 | 看 `data/captcha/login.png` 這張圖；把 `mode` 改成 `"manual"`，跑的時候把答案寫進 `data/handoff-code.txt` |
| 驗證碼圖抓不到 | selector 錯，或圖是 canvas | 用 DevTools 找真正的 `<img>`；canvas 的話改用 `shot` 截區域 |
| `ddddocr unavailable` | 沒裝 Python 套件 | `pip install ddddocr pillow`（若 Python 3.13 裝不起來，用 3.11/3.12 的 venv，或直接用 `manual` 模式） |
| 登入成功卻又被踢回登入頁 | session cookie 沒帶到 / 站方限一裝置 | 確認用的是同一個 `data/profile`（別每次換 profile） |

## 註冊

| 症狀 | 原因 | 處理 |
|---|---|---|
| 卡在 `waitVisible #submit-btn` | Turnstile 沒過（無人值守時很正常） | 這是設計上的停等點：把 `timeoutMs` 調大，或先手動過一次人機驗證；也可以暫時把注册步驟拆出來手動做 |
| 註冊後 `accounts.json` 有帳號但登入不了 | 帳號還沒生效 / 信箱沒驗證 | 看 `data/shots/signup-*.png`；必要時把該帳號標 `"disabled": true` 跳過 |
| 信箱重複 | `plusAlias` 撞名，或手動佇列重複 | 換 `plusAlias.tag`，或清 `data/mailboxes.used.txt` |

## 作答 / 送出

| 症狀 | 原因 | 處理 |
|---|---|---|
| `找不到題目：input.answer` | 頁面還沒載完，或 selector 不符 | 前面加 `waitVisible`；用 `probe --site` 確認 `groupSelector` 找到幾組 |
| `第 N 題沒有 value=5 的選項` | 這頁不是量表題 | 量表頁才用 `answerByValue`；技能題用 `answerByBank` |
| `題庫缺少答案（qid=…）` | 題目換了 / 新增題 | 跑 `node run.mjs teach` 抓新題，補 `answerText` |
| `點擊未生效（qid=…）` | 選項被 label 包住但點到了 label 的空白處 | 已內建退回 `el.click()`；仍失敗就把 `answerGapMs` 調大（有些站有節流） |
| 送出後停在原頁 | 按鈕 disabled 或有前置檢查 | 用 `assert` 加上「送出後應該看到的元素」，讓它明確報錯而不是靜默卡住 |
| 次數沒增加 | 站方用「看過才算」的機制 | 保留 `scrollEnd` 的 `dwellMs`（例如 5000） |

## 進度 / 停止

| 症狀 | 原因 | 處理 |
|---|---|---|
| `node run.mjs stop` 後還在跑 | 正在等 `sleep` 或 `countdown` | 最多等一輪結束；要立刻停就關掉那個視窗，或 `Stop-Process` 該 node 行程 |
| `report` 數字跟網站不一致 | `progress.read` 抓錯元素 | 用 `eval` 印 `document.body.innerText` 對照，改成正確的表達式 |
| 每輪都失敗但沒有錯誤訊息 | 錯誤被 `optional: true` 吞掉 | 先把 `optional` 拿掉，讓它報錯 |

## 檔案 / 版控

| 症狀 | 原因 | 處理 |
|---|---|---|
| `config/config.json` 沒被 commit | 正常，`.gitignore` 有列 | 個人資料就是要留本機 |
| `data/` 想備份 | 它是執行資料 | 複製整個 `data/`（不含 `profile/` 可省很多空間） |
| 換電腦 | — | 複製 `config/config.json` + `data/accounts.json` + `sites/`，`data/profile` 可重建（但登入態要重登） |
