// flow.mjs — 聲明式步驟引擎：站點規則就是一份 JSON 的步驟陣列
// 換站 = 換 sites/<name>.json 裡的 URL 與 selector，不用改程式。
import fs from 'node:fs';
import path from 'node:path';
import { sleep } from './cdp.mjs';
import { answerByValue, answerByBank, captureCaptcha, ocrWithDdddocr, waitForManualCode } from './actions.mjs';

export function getPath(obj, p) {
  if (!p) return undefined;
  return p.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

export function interpolate(v, vars) {
  if (typeof v !== 'string') return v;
  return v.replace(/\$\{([^}]+)\}/g, (_, expr) => {
    const val = getPath(vars, expr.trim());
    return val === undefined || val === null ? '' : String(val);
  });
}

export class Flow {
  /**
   * @param {object} o
   * @param {import('./cdp.mjs').Cdp} o.cdp
   * @param {object} o.human
   * @param {object} o.vars   變數（site/base/account/profile/config…）
   * @param {string} o.dataDir
   * @param {boolean} o.dryRun
   * @param {(msg:string)=>void} o.log
   */
  constructor({ cdp, human, vars, dataDir, dryRun = false, log = () => {} }) {
    this.cdp = cdp;
    this.human = human;
    this.vars = { ...vars };
    this.dataDir = dataDir;
    this.dryRun = dryRun;
    this.log = log;
    this.stopFlag = path.join(dataDir, 'stop.flag');
  }

  shouldStop() {
    return fs.existsSync(this.stopFlag);
  }

  /** 等元素出現在畫面上且可見（例如 Turnstile 通過後才顯示的送出鈕） */
  async waitVisible(selector, timeoutMs = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (this.shouldStop()) throw Object.assign(new Error('STOP'), { stopFlow: true });
      const ok = await this.cdp.evalSafe(`(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const st = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none';
      })()`);
      if (ok) return true;
      await sleep(400);
    }
    throw new Error(`等待元素可見逾時：${selector}`);
  }

  /** 等某個 JS 條件為真 */
  async until(cond, timeoutMs = 30000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (this.shouldStop()) throw Object.assign(new Error('STOP'), { stopFlow: true });
      if (await this.cdp.evalSafe(cond)) return true;
      await sleep(400);
    }
    throw new Error(`等待條件逾時：${cond}`);
  }

  async run(steps, scope = {}) {
    const merged = { ...this.vars, ...scope };
    for (let i = 0; i < steps.length; i++) {
      if (this.shouldStop()) {
        this.log('偵測到 stop.flag，中止流程');
        return { stopped: true, at: i };
      }
      const s = steps[i];
      await this.step(s, merged, i);
    }
    return { stopped: false };
  }

  async step(raw, vars, idx = 0) {
    const s = { ...raw };
    const a = s.a || s.action;
    const label = s.label ? ` ${s.label}` : '';
    const tag = `[${idx + 1}] ${a}${label}`;
    const isDanger = s.danger === true;

    if (isDanger && this.dryRun) {
      this.log(`${tag} → dry-run 跳過（寫入類動作）`);
      return;
    }

    switch (a) {
      case 'goto': {
        const url = interpolate(s.url, vars);
        this.log(`${tag} → ${url}`);
        const pat = s.waitForRe ? new RegExp(s.waitForRe) : s.waitFor ? s.waitFor : null;
        await this.cdp.navigate(url, { waitFor: pat, timeoutMs: s.timeoutMs || 30000 });
        break;
      }
      case 'wait': {
        if (s.selector) {
          this.log(`${tag} → 等元素 ${s.selector}`);
          await this.cdp.waitSelector(s.selector, s.timeoutMs || 20000);
        } else {
          const pat = s.waitForRe ? new RegExp(s.waitForRe) : s.waitFor;
          this.log(`${tag} → 等網址 ${pat}`);
          await this.cdp.waitUrl(pat, s.timeoutMs || 30000);
        }
        break;
      }
      case 'click': {
        this.log(`${tag} → ${s.selector}`);
        await this.human.click(s.selector, {
          optional: !!s.optional,
          dwellMs: s.dwellMs ?? undefined,
          verify: s.verify ? interpolate(s.verify, vars) : null,
        });
        break;
      }
      case 'clickText': {
        this.log(`${tag} → 「${interpolate(s.text, vars)}」`);
        await this.human.clickText(s.selector || 'button,a', interpolate(s.text, vars), {
          exact: !!s.exact,
          optional: !!s.optional,
        });
        break;
      }
      case 'type': {
        const text = interpolate(s.text, vars);
        this.log(`${tag} → ${s.selector} ← ${s.mask ? '••••' : text}`);
        await this.human.type(s.selector, text, { clear: s.clear !== false, optional: !!s.optional });
        break;
      }
      case 'select': {
        const value = interpolate(s.value, vars);
        this.log(`${tag} → ${s.selector} = ${value}`);
        await this.human.select(s.selector, value);
        break;
      }
      case 'waitVisible': {
        const sel = interpolate(s.selector, vars);
        this.log(`${tag} → 等 ${sel} 可見`);
        await this.waitVisible(sel, s.timeoutMs || 30000);
        break;
      }
      case 'until': {
        this.log(`${tag} → 等條件成立`);
        await this.until(interpolate(s.cond, vars), s.timeoutMs || 30000);
        break;
      }
      case 'answerByValue': {
        this.log(`${tag} → ${s.groupSelector} 全選 value=${s.value}`);
        const r = await answerByValue(this.cdp, this.human, {
          groupSelector: s.groupSelector,
          value: s.value,
          log: (m) => this.log('   ' + m),
        });
        this.vars.lastAnswer = r;
        break;
      }
      case 'answerByBank': {
        const bankFile = path.resolve(interpolate(s.bank, vars));
        this.log(`${tag} → ${s.groupSelector} 依題庫 ${path.basename(bankFile)}`);
        const bank = loadBank(bankFile);
        const picks = await answerByBank(this.cdp, this.human, {
          groupSelector: s.groupSelector,
          bank,
          fallback: s.fallback || 'fail',
          log: (m) => this.log('   ' + m),
        });
        this.vars.lastPicks = picks;
        break;
      }
      case 'scrollEnd': {
        this.log(`${tag} → 滑到頁尾並停留 ${s.dwellMs ?? 5000}ms`);
        await this.human.scrollToEnd({ dwellMs: s.dwellMs ?? 5000 });
        break;
      }
      case 'countdown': {
        await this.human.countdown(s.sec ?? 5, interpolate(s.label || '', vars));
        break;
      }
      case 'sleep': {
        this.log(`${tag} → ${s.ms}ms`);
        await sleep(s.ms || 1000);
        break;
      }
      case 'gap': {
        await this.human.gap(s.ms ?? undefined);
        break;
      }
      case 'eval': {
        const expr = interpolate(s.expr, vars);
        const val = await this.cdp.eval(expr);
        if (s.save) this.vars[s.save] = val;
        if (s.expect !== undefined) {
          const ok = s.expect === 'truthy' ? !!val : String(val) === String(s.expect);
          if (!ok) throw new Error(`eval 結果不符預期：${s.save || 'expr'} = ${JSON.stringify(val)}`);
        }
        if (s.log !== false) this.log(`${tag} → ${JSON.stringify(val)?.slice(0, 200)}`);
        break;
      }
      case 'assert': {
        const expr = interpolate(s.expr, vars);
        const ok = await this.cdp.evalSafe(expr);
        if (!ok) throw new Error(s.message || `斷言失敗：${expr}`);
        this.log(`${tag} → 通過`);
        break;
      }
      case 'shot': {
        const file = path.resolve(interpolate(s.path, vars));
        await this.cdp.shot(file, { fullPage: !!s.fullPage });
        this.log(`${tag} → ${file}`);
        break;
      }
      case 'ocr': {
        const file = path.resolve(interpolate(s.file || 'data/captcha.png', vars));
        await captureCaptcha(this.cdp, interpolate(s.imageSelector, vars), file);
        const mode = s.mode || 'auto'; // auto | ddddocr | manual
        let code = null;
        if (mode !== 'manual') code = await ocrWithDdddocr(file, { python: s.python || 'python', log: (m) => this.log('   ' + m) });
        if (!code) {
          this.log(`   等待人工輸入驗證碼 → ${path.join(this.dataDir, 'handoff-code.txt')}`);
          code = await waitForManualCode({
            file: path.join(this.dataDir, 'handoff-code.txt'),
            timeoutMs: s.timeoutMs || 180000,
            log: (m) => this.log('   ' + m),
          });
        }
        if (!code) throw new Error('驗證碼取得失敗');
        const cleaned = s.digitsOnly ? String(code).replace(/[^0-9a-zA-Z]/g, '') : String(code);
        this.vars[s.save || 'captcha'] = cleaned;
        this.log(`   驗證碼：${cleaned}`);
        break;
      }
      case 'if': {
        const cond = await this.cdp.evalSafe(interpolate(s.cond, vars));
        const branch = cond ? s.then : s.else;
        if (Array.isArray(branch) && branch.length) {
          this.log(`${tag} → ${cond ? 'then' : 'else'}（${branch.length} 步）`);
          await this.run(branch, vars);
        }
        break;
      }
      case 'repeat': {
        const times = Number(interpolate(s.times, vars)) || 1;
        for (let i = 1; i <= times; i++) {
          if (this.shouldStop()) return;
          this.log(`${tag} → 第 ${i}/${times} 次`);
          await this.run(s.steps || [], { ...vars, i, index: i });
          if (s.gapMs) await sleep(s.gapMs);
        }
        break;
      }
      case 'forCount': {
        // 反覆執行直到 eval 值 >= target（例如：抽獎次數到 60）
        const target = Number(interpolate(s.target ?? 60, vars));
        const max = Number(interpolate(s.max ?? 100, vars));
        for (let i = 1; i <= max; i++) {
          if (this.shouldStop()) return;
          const val = Number(await this.cdp.evalSafe(interpolate(s.watchExpr, vars)));
          if (Number.isFinite(val) && val >= target) {
            this.log(`${tag} → 已達標（${val} >= ${target}）`);
            break;
          }
          this.log(`${tag} → 第 ${i} 次（目前 ${val} / ${target}）`);
          await this.run(s.steps || [], { ...vars, i, index: i, used: val });
          if (s.gapMs) await sleep(s.gapMs);
        }
        break;
      }
      case 'log': {
        this.log(interpolate(s.text, vars));
        break;
      }
      case 'stop': {
        this.log(`${tag} → 主動結束`);
        throw Object.assign(new Error('STOP'), { stopFlow: true });
        break;
      }
      default:
        throw new Error(`未知動作：${a}`);
    }
  }
}
