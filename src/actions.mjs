// actions.mjs — 通用動作：選擇題自動作答、元素抽取、驗證碼
import fs from 'node:fs';
import path from 'node:path';
import { sleep, Cdp } from './cdp.mjs';
import { pickByBank } from './answers.mjs';

const GROUP_JS = (groupSelector) => `(() => {
  const items = [...document.querySelectorAll(${JSON.stringify(groupSelector)})];
  const keyOf = (el) => el.name || el.id || '';
  const names = [...new Set(items.map(keyOf))].filter(Boolean);
  const out = [];
  for (const n of names) {
    const inputs = items.filter((el) => keyOf(el) === n);
    if (!inputs.length) continue;
    const options = inputs.map((el) => {
      let text = '';
      if (el.id) {
        const lab = document.querySelector('label[for="' + el.id + '"]');
        if (lab) text = (lab.innerText || lab.textContent || '').trim();
      }
      if (!text) {
        const wrap = el.closest('label');
        if (wrap) text = (wrap.innerText || wrap.textContent || '').trim();
      }
      if (!text && el.parentElement) text = (el.parentElement.innerText || '').trim();
      return { id: el.id, value: el.value, name: el.name || '', text: text.replace(/\\s+/g, ' ').trim() };
    });
    // 題幹：往上找容器，扣掉所有選項文字後還剩夠長的字串
    let stem = '';
    let node = inputs[0].parentElement;
    for (let k = 0; k < 8 && node; k++) {
      let rest = node.innerText || '';
      for (const o of options) if (o.text) rest = rest.split(o.text).join(' ');
      rest = rest.replace(/\\s+/g, ' ').trim();
      if (rest.length > 20) { stem = rest; break; }
      node = node.parentElement;
    }
    out.push({
      name: n,
      qid: (inputs[0].id || '').split('_')[1] || n,
      stem,
      options,
      checked: inputs.some((el) => el.checked),
    });
  }
  return out;
})()`;

export async function extractGroups(cdp, groupSelector) {
  const r = await cdp.eval(GROUP_JS(groupSelector));
  return Array.isArray(r) ? r : [];
}

/** 每組選同一個 value（例如量表題全選「非常同意」= 5） */
export async function answerByValue(cdp, human, { groupSelector, value = '5', log = () => {} }) {
  const groups = await extractGroups(cdp, groupSelector);
  if (!groups.length) throw new Error(`找不到題目：${groupSelector}`);
  let done = 0;
  for (const g of groups) {
    const opt = g.options.find((o) => String(o.value) === String(value));
    if (!opt) throw new Error(`第 ${g.qid} 題沒有 value=${value} 的選項`);
    const sel = opt.id ? `#${cssEscape(opt.id)}` : `[name="${cssEscape(g.name)}"][value="${cssEscape(String(value))}"]`;
    await human.gap();
    await human.click(sel, { dwellMs: 1000 });
    const ok = await cdp.evalSafe(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!(el && el.checked); })()`);
    if (!ok) {
      await cdp.evalSafe(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.click(); return 1; })()`);
    }
    done++;
    log(`  ${g.qid} → ${opt.text || opt.value}（${done}/${groups.length}）`);
  }
  return { groups: groups.length, answered: done };
}

/** 每組依題庫挑選項；找不到就用 fallback 策略 */
export async function answerByBank(cdp, human, { groupSelector, bank, fallback = 'fail', log = () => {} }) {
  const groups = await extractGroups(cdp, groupSelector);
  if (!groups.length) throw new Error(`找不到題目：${groupSelector}`);
  const picks = [];
  for (const g of groups) {
    let pick = pickByBank(bank, g);
    if (!pick) {
      if (fallback === 'first') pick = { ...g.options[0], how: 'fallback:first' };
      else if (fallback === 'random') pick = { ...g.options[Math.floor(Math.random() * g.options.length)], how: 'fallback:random' };
      else throw new Error(`題庫缺少答案（qid=${g.qid}，題幹：${g.stem.slice(0, 40)}）`);
    }
    const sel = pick.id ? `#${cssEscape(pick.id)}` : null;
    if (!sel) throw new Error(`選項沒有 id，無法定位（qid=${g.qid}）`);
    await human.gap();
    await human.click(sel, { dwellMs: 1000 });
    let ok = await cdp.evalSafe(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!(el && el.checked); })()`);
    if (!ok) {
      await cdp.evalSafe(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.click(); return 1; })()`);
      ok = await cdp.evalSafe(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return !!(el && el.checked); })()`);
      if (!ok) throw new Error(`點擊未生效（qid=${g.qid}）`);
    }
    picks.push({ qid: g.qid, stem: g.stem, chosen: pick.text, how: pick.how });
    log(`  ${g.qid} → ${pick.text}（${pick.how}）`);
  }
  return picks;
}

export function cssEscape(s) {
  return String(s).replace(/["\\]/g, '\\$&');
}

/** 抓驗證碼圖：裁切元素 → PNG 檔；回傳檔案路徑 */
export async function captureCaptcha(cdp, selector, outFile) {
  const box = await cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: r.width, height: r.height, scale: devicePixelRatio || 1 };
  })()`);
  if (!box) throw new Error(`找不到驗證碼圖：${selector}`);
  const r = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 2 },
  });
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, Buffer.from(r.data, 'base64'));
  return outFile;
}

/** 用本機 python + ddddocr 辨識（可選；沒裝就回 null） */
export async function ocrWithDdddocr(file, { python = 'python', log = () => {} } = {}) {
  const { spawnSync } = await import('node:child_process');
  const script = path.join(process.cwd(), 'scripts', 'ocr.py');
  if (!fs.existsSync(script)) return null;
  const r = spawnSync(python, [script, file], { encoding: 'utf8', timeout: 60000 });
  if (r.error || r.status !== 0) {
    log(`  OCR 不可用（${r.error?.message || r.stderr?.trim() || 'exit ' + r.status}）`);
    return null;
  }
  const text = String(r.stdout || '').trim().split(/\s+/).pop();
  if (!text) return null;
  log(`  OCR 結果：${text}`);
  return text;
}

/** 等待人工輸入驗證碼（寫在 data/handoff 檔或直接在 console 問） */
export async function waitForManualCode({ file, timeoutMs = 180000, pollMs = 1500, log = () => {} } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fs.existsSync(file)) {
      const v = fs.readFileSync(file, 'utf8').trim();
      if (v) {
        fs.unlinkSync(file);
        return v;
      }
    }
    await sleep(pollMs);
  }
  return null;
}

export async function attachPage(port, match) {
  return await Cdp.attach({ port, match });
}
