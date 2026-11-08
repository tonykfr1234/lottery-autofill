// cdp.mjs — 零依賴 Chrome DevTools Protocol 驅動
// 需要 Node.js >= 22（內建 fetch / WebSocket）
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function timer(ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, stop: () => clearTimeout(t) };
}

/** 探測某個 port 上是否有 CDP 在聽；有就回傳 version 物件 */
export async function probePort(port, timeoutMs = 1500) {
  const t = timer(timeoutMs);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: t.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  } finally {
    t.stop();
  }
}

export async function listTargets(port) {
  const t = timer(6000);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: t.signal });
    if (!r.ok) throw new Error(`CDP /json/list HTTP ${r.status}`);
    return await r.json();
  } finally {
    t.stop();
  }
}

export async function newTab(port, url = 'about:blank') {
  const t = timer(10000);
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
      method: 'PUT',
      signal: t.signal,
    });
    if (!r.ok) throw new Error(`CDP /json/new HTTP ${r.status}`);
    return await r.json();
  } finally {
    t.stop();
  }
}

export function chromeCandidates() {
  const out = [];
  if (process.platform === 'win32') {
    out.push('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    out.push('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
    if (process.env.LOCALAPPDATA) out.push(path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  } else if (process.platform === 'darwin') {
    out.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    if (process.env.HOME) out.push(path.join(process.env.HOME, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'));
  } else {
    out.push(
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    );
  }
  return out;
}

export function findChrome(explicit) {
  if (explicit && fs.existsSync(explicit)) return explicit;
  for (const p of chromeCandidates()) if (fs.existsSync(p)) return p;
  return null;
}

/**
 * 確認 Chrome 帶 CDP 在跑；沒有就用專屬 profile 開一個。
 * 同一個 port 只會有一個 Chrome，避免多實例互搶。
 */
export async function ensureChrome({ port = 9333, userDataDir, chromePath, extraArgs = [], log = () => {} } = {}) {
  const alive = await probePort(port);
  if (alive) {
    log(`CDP ${port} 已就緒：${alive.Browser}`);
    return { started: false, browser: alive.Browser };
  }
  const exe = findChrome(chromePath);
  if (!exe) throw new Error('找不到 Chrome：請安裝 Google Chrome，或在 config.json 設定 chromePath');
  if (!userDataDir) throw new Error('ensureChrome 需要 userDataDir');
  fs.mkdirSync(userDataDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=Translate',
    '--window-size=1440,960',
    ...extraArgs,
    'about:blank',
  ];

  log(`啟動 Chrome：${exe}`);
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.unref();

  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    await sleep(500);
    const v = await probePort(port);
    if (v) {
      log(`Chrome 已啟動，CDP ${port} 就緒`);
      return { started: true, browser: v.Browser };
    }
  }
  throw new Error(`Chrome 啟動後 30 秒內沒有開放 CDP 埠 ${port}`);
}

function toRegExp(pattern) {
  if (!pattern) return null;
  if (pattern instanceof RegExp) return pattern;
  return new RegExp(String(pattern).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

export class Cdp {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.seq = 0;
    this.pending = new Map();
    this.closed = false;
  }

  /** 連到符合 match 的分頁；找不到就開新分頁 */
  static async attach({ port = 9333, match = null, createIfMissing = true, log = () => {} } = {}) {
    const targets = await listTargets(port);
    const pages = targets.filter((t) => t.type === 'page');
    const re = toRegExp(match);
    let hit = null;
    if (re) hit = pages.find((t) => re.test(t.url));
    if (!hit && !re) hit = pages.find((t) => /^https?:/.test(t.url)) || pages[0];
    if (!hit) {
      if (!createIfMissing) throw new Error('找不到可用分頁');
      log('沒有符合的分頁，開新分頁');
      hit = await newTab(port, 'about:blank');
    }
    if (!/^ws/.test(hit.webSocketDebuggerUrl || '')) throw new Error('分頁沒有 WebSocket 端點');
    const c = new Cdp(hit.webSocketDebuggerUrl);
    await c.connect();
    await c.send('Page.enable').catch(() => {});
    await c.send('Runtime.enable').catch(() => {});
    return c;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('CDP WebSocket 連線失敗')));
      ws.addEventListener('close', () => {
        this.closed = true;
        for (const [, h] of this.pending) {
          clearTimeout(h.timer);
          h.reject(new Error('CDP 連線已關閉'));
        }
        this.pending.clear();
      });
      ws.addEventListener('message', (ev) => {
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (!m.id || !this.pending.has(m.id)) return;
        const h = this.pending.get(m.id);
        this.pending.delete(m.id);
        clearTimeout(h.timer);
        if (m.error) h.reject(new Error(`${h.method}: ${JSON.stringify(m.error)}`));
        else h.resolve(m.result);
      });
    });
  }

  send(method, params = {}, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error('CDP 已關閉'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 逾時（${timeoutMs}ms）：${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer: t, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression, timeoutMs = 30000) {
    const r = await this.send(
      'Runtime.evaluate',
      { expression, returnByValue: true, awaitPromise: true, userGesture: true },
      timeoutMs,
    );
    if (r.exceptionDetails) {
      const d = r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'eval 失敗';
      throw new Error(String(d).split('\n')[0]);
    }
    return r.result?.value;
  }

  /** eval 但不拋錯（用於輪詢） */
  async evalSafe(expression, timeoutMs = 15000) {
    try {
      return await this.eval(expression, timeoutMs);
    } catch {
      return undefined;
    }
  }

  async href() {
    return await this.eval('location.href');
  }

  async navigate(url, { waitFor = null, timeoutMs = 30000, settleMs = 400 } = {}) {
    await this.send('Page.navigate', { url }).catch(() => {});
    if (!waitFor) {
      await sleep(settleMs);
      return await this.evalSafe('location.href');
    }
    return await this.waitUrl(waitFor, timeoutMs);
  }

  async waitUrl(pattern, timeoutMs = 30000) {
    const re = toRegExp(pattern);
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < timeoutMs) {
      const s = await this.evalSafe('location.href + "\u0001" + document.readyState');
      if (typeof s === 'string') {
        const [href, ready] = s.split('\u0001');
        last = href;
        if (re.test(href) && ready === 'complete') {
          await sleep(400);
          return href;
        }
      }
      await sleep(300);
    }
    throw new Error(`等待網址 ${re} 逾時（目前：${last}）`);
  }

  async waitSelector(selector, timeoutMs = 20000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const ok = await this.evalSafe(`!!document.querySelector(${JSON.stringify(selector)})`);
      if (ok) return true;
      await sleep(250);
    }
    throw new Error(`等待元素 ${selector} 逾時`);
  }

  async shot(file, { fullPage = false } = {}) {
    const r = await this.send('Page.captureScreenshot', fullPage ? { format: 'png', captureBeyondViewport: true } : { format: 'png' });
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}
