// human.mjs — 真實滑鼠／鍵盤操作（看起來像人，而不是 el.click()）
import { sleep } from './cdp.mjs';

const DEFAULT = {
  moveMs: 120, // 移到目標後的停頓
  pressMs: 150, // 按下到放開
  dwellMs: 1000, // 點完停在原處（使用者的硬性要求：每次點擊後停 1 秒）
  scrollSettleMs: 500, // 捲動後的版面穩定時間
  answerGapMs: 1000, // 每題之間的間隔
  countdownSec: 5, // 送出前的倒數
  dryRun: false,
  log: () => {},
};

export function createHuman(cdp, options = {}) {
  const o = { ...DEFAULT, ...options };

  /** 量元素位置（先 scrollIntoView + focus，再等版面穩定後重量） */
  async function locate(selector) {
    const first = await cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      try { el.focus({ preventScroll: true }); } catch (e) {}
      return true;
    })()`);
    if (!first) return null;
    await sleep(o.scrollSettleMs);
    return await cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return null;
      return { x: r.x, y: r.y, width: r.width, height: r.height,
               cx: r.x + r.width / 2, cy: r.y + r.height / 2,
               vw: innerWidth, vh: innerHeight };
    })()`);
  }

  async function clickPoint(x, y, { dwellMs = o.dwellMs } = {}) {
    if (o.dryRun) {
      o.log(`[dry-run] 跳過點擊 (${Math.round(x)},${Math.round(y)})`);
      return;
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
    await sleep(o.moveMs);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await sleep(o.pressMs);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(dwellMs);
  }

  /** 用真實滑鼠點元素；元素不存在且 optional 時回傳 false */
  async function click(selector, { optional = false, dwellMs = o.dwellMs, verify = null } = {}) {
    const box = await locate(selector);
    if (!box) {
      if (optional) return false;
      throw new Error(`找不到元素：${selector}`);
    }
    await clickPoint(box.cx, box.cy, { dwellMs });
    if (verify) {
      const ok = await cdp.evalSafe(verify);
      if (!ok) {
        // 真實點擊沒生效時退回 DOM click（某些 SPA 需要）
        await cdp.evalSafe(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.click(); return 1; })()`);
        await sleep(300);
        const ok2 = await cdp.evalSafe(verify);
        if (!ok2) throw new Error(`點擊後狀態未變：${selector}`);
      }
    }
    return true;
  }

  /** 依文字點元素（selector 為候選範圍，例如 button） */
  async function clickText(selector, text, { exact = false, optional = false } = {}) {
    const idx = await cdp.eval(`(() => {
      const want = ${JSON.stringify(text)};
      const nodes = [...document.querySelectorAll(${JSON.stringify(selector)})];
      const norm = (s) => (s || '').replace(/\\s+/g, '');
      for (let i = 0; i < nodes.length; i++) {
        const t = norm(nodes[i].innerText || nodes[i].textContent || '');
        if (${exact} ? t === norm(want) : t.includes(norm(want))) return i;
      }
      return -1;
    })()`);
    if (idx === undefined || idx === null || idx < 0) {
      if (optional) return false;
      throw new Error(`找不到含文字「${text}」的 ${selector}`);
    }
    const box = await cdp.eval(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${idx}];
      el.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = el.getBoundingClientRect();
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    })()`);
    await sleep(o.scrollSettleMs);
    const box2 = await cdp.eval(`(() => {
      const el = [...document.querySelectorAll(${JSON.stringify(selector)})][${idx}];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    })()`);
    const p = box2 || box;
    await clickPoint(p.cx, p.cy);
    return true;
  }

  /** 輸入文字：真實 focus + 全選 + 逐字輸入 */
  async function type(selector, text, { clear = true, optional = false } = {}) {
    const box = await locate(selector);
    if (!box) {
      if (optional) return false;
      throw new Error(`找不到輸入框：${selector}`);
    }
    await clickPoint(box.cx, box.cy, { dwellMs: 200 });
    if (o.dryRun) {
      o.log(`[dry-run] 跳過輸入 ${selector} <- ${text}`);
      return true;
    }
    await cdp.evalSafe(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.focus(); ${clear ? 'el.select && el.select();' : ''} } return 1; })()`);
    if (clear) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    }
    for (const ch of String(text)) {
      await cdp.send('Input.insertText', { text: ch });
      await sleep(25 + Math.floor(Math.random() * 35));
    }
    await sleep(120);
    return true;
  }

  /** 原生 <select>：先真實點一下，再用 JS 設值並派發 change（瀏覽器下拉選單無法用滑鼠定位） */
  async function select(selector, value) {
    const box = await locate(selector);
    if (!box) throw new Error(`找不到下拉選單：${selector}`);
    if (!o.dryRun) {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.cx, y: box.cy, button: 'left', clickCount: 1 });
      await sleep(150);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.cx, y: box.cy, button: 'left', clickCount: 1 });
      await sleep(500);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(250);
    }
    const got = await cdp.eval(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return 'missing';
      el.value = ${JSON.stringify(String(value))};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return el.value;
    })()`);
    await sleep(400);
    if (!o.dryRun && got !== 'missing' && String(got) !== String(value)) {
      o.log(`  警告：${selector} 設定為 ${got}（想要 ${value}）`);
    }
    return got;
  }

  async function scrollToEnd({ dwellMs = 5000 } = {}) {
    await cdp.evalSafe('window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" }); 1');
    await sleep(o.scrollSettleMs);
    if (dwellMs > 0) await sleep(dwellMs);
  }

  async function countdown(sec = o.countdownSec, label = '') {
    for (let s = sec; s > 0; s--) {
      o.log(`倒數 ${s} 秒… ${label}`);
      await sleep(1000);
    }
  }

  async function gap(ms = o.answerGapMs) {
    if (ms > 0) await sleep(ms + Math.floor(Math.random() * 200));
  }

  return { locate, click, clickText, clickPoint, type, select, scrollToEnd, countdown, gap, options: o };
}
