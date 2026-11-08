#!/usr/bin/env node
// run.mjs — 命令列入口
//   node run.mjs doctor
//   node run.mjs probe    --site isafeevent
//   node run.mjs run      --site isafeevent [--max 3] [--dry-run]
//   node run.mjs report
//   node run.mjs stop
//   node run.mjs teach    --site isafeevent
//   node run.mjs new-site mysite --url https://example.com --match example.com
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Cdp, ensureChrome, probePort, sleep, findChrome } from './src/cdp.mjs';
import { createHuman } from './src/human.mjs';
import { Flow, interpolate } from './src/flow.mjs';
import { extractGroups } from './src/actions.mjs';
import { Store, ensureDir, readJson } from './src/store.mjs';
import { Mailbox, randomPet } from './src/mailbox.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const stamp = () => new Date().toTimeString().slice(0, 8);
const log = (m) => console.log(`[${stamp()}] ${m}`);

// ---------- 參數 ----------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

function readConfig(opts) {
  const file = path.resolve(ROOT, opts.config || 'config/config.json');
  if (!fs.existsSync(file)) {
    const example = path.resolve(ROOT, 'config/config.example.json');
    if (fs.existsSync(example)) {
      console.warn(`[${stamp()}] 找不到 ${file}，先用 config.example.json 示範值（建議複製成 config/config.json 再改）`);
      return readJson(example, {});
    }
    throw new Error(`找不到設定檔：${file}`);
  }
  return readJson(file, {});
}

function readSite(opts, config) {
  const id = opts.site || config.defaultSite || 'isafeevent';
  const candidates = [
    path.resolve(ROOT, 'sites', `${id}.json`),
    path.resolve(ROOT, 'sites', id, 'site.json'),
    path.resolve(ROOT, id),
  ];
  const file = candidates.find((f) => fs.existsSync(f));
  if (!file) throw new Error(`找不到站點設定：${id}（可用：${fs.readdirSync(path.join(ROOT, 'sites')).filter((f) => f.endsWith('.json')).join(', ')}）`);
  const site = readJson(file, null);
  if (!site) throw new Error(`站點設定解析失敗：${file}`);
  site._file = file;
  site._dir = path.dirname(file);
  return site;
}

function varsFor(site, config, account = {}, extra = {}) {
  return {
    base: site.baseUrl,
    site,
    config,
    account,
    profile: config.profile || {},
    dataDir: path.resolve(ROOT, config.dataDir || 'data'),
    now: Date.now(),
    ...extra,
  };
}

// ---------- doctor ----------
async function cmdDoctor(opts) {
  const report = [];
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  report.push(['Node.js', `${process.versions.node}`, nodeMajor >= 22 ? 'OK' : '需要 >= 22']);
  const chrome = findChrome();
  report.push(['Chrome', chrome || '找不到', chrome ? 'OK' : '請安裝 Google Chrome']);

  let config = {};
  try {
    config = readConfig(opts);
    report.push(['設定檔', opts.config || 'config/config.json', 'OK']);
  } catch (e) {
    report.push(['設定檔', e.message, '缺少']);
  }
  const port = Number(opts.port || config.cdpPort || 9333);
  const alive = await probePort(port);
  report.push(['CDP 埠', `${port} ${alive ? alive.Browser : '（未啟動）'}`, alive ? 'OK' : '執行時會自動啟動']);

  let site = null;
  try {
    site = readSite(opts, config);
    report.push(['站點設定', `${site.id} → ${site._file}`, 'OK']);
    const u = new URL(site.baseUrl);
    const r = await fetch(u.origin, { method: 'HEAD' }).catch((e) => ({ ok: false, status: String(e.message) }));
    report.push(['站點連線', `${u.origin} → ${r.status || ''}`, r.ok ? 'OK' : '注意']);
  } catch (e) {
    report.push(['站點設定', e.message, '缺少']);
  }

  const bankRel = site?.unit?.steps?.find((s) => s.a === 'answerByBank' || s.action === 'answerByBank')?.bank;
  if (bankRel) {
    const bankFile = path.resolve(ROOT, interpolate(bankRel, varsFor(site, config)));
    report.push(['答案庫', `${bankFile} ${fs.existsSync(bankFile) ? '' : '（不存在）'}`, fs.existsSync(bankFile) ? 'OK' : '需要建立']);
  }

  const width = Math.max(...report.map((r) => String(r[0]).length));
  console.log('\n=== 環境檢查 ===');
  for (const [k, v, s] of report) console.log(`${String(k).padEnd(width)}  ${String(v).padEnd(46)} ${s}`);
  console.log('');
  return report.every((r) => !/需要|缺少/.test(r[2])) ? 0 : 1;
}

// ---------- probe ----------
async function cmdProbe(opts) {
  const config = readConfig(opts);
  const site = readSite(opts, config);
  const port = Number(opts.port || config.cdpPort || 9333);
  if (!opts['no-chrome']) await ensureChrome({ port, userDataDir: path.resolve(ROOT, config.userDataDir || 'data/profile'), chromePath: config.chromePath, log });
  const cdp = await Cdp.attach({ port, match: site.matchUrl, log });
  const human = createHuman(cdp, { dryRun: true, log });
  const flow = new Flow({ cdp, human, vars: varsFor(site, config), dataDir: path.resolve(ROOT, config.dataDir || 'data'), dryRun: true, log });

  log(`站點：${site.name || site.id}  ${site.baseUrl}`);
  await cdp.navigate(site.baseUrl, { waitFor: site.probe?.waitForRe ? new RegExp(site.probe.waitForRe) : null });
  log(`已到達：${await cdp.href()}  title=${await cdp.evalSafe('document.title')}`);

  for (const sel of site.probe?.selectors || []) {
    const n = await cdp.evalSafe(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
    log(`  選擇器 ${sel} → ${n ?? 0} 個`);
  }
  const groups = site.probe?.groupSelector ? await extractGroups(cdp, site.probe.groupSelector) : [];
  if (groups.length) log(`  題目群組 ${groups.length} 組（第一組 qid=${groups[0].qid}）`);
  cdp.close();
  return 0;
}

// ---------- teach ----------
async function cmdTeach(opts) {
  const config = readConfig(opts);
  const site = readSite(opts, config);
  const port = Number(opts.port || config.cdpPort || 9333);
  const cdp = await Cdp.attach({ port, match: site.matchUrl, log });
  const groupSelector = opts.selector || site.probe?.groupSelector || 'input.answer';
  const groups = await extractGroups(cdp, groupSelector);
  if (!groups.length) {
    log(`目前頁面找不到題目（${groupSelector}），請先手動把瀏覽器停在題目頁再跑 teach`);
    cdp.close();
    return 1;
  }
  const bankFile = path.resolve(ROOT, opts.out || 'data/answers.capture.json');
  ensureDir(path.dirname(bankFile));
  const existing = readJson(bankFile, { questions: {} });
  for (const g of groups) {
    existing.questions[g.qid] = {
      stem: g.stem.slice(0, 120),
      options: g.options.map((o) => `${o.value}:${o.text}`),
      answerText: existing.questions[g.qid]?.answerText || '',
    };
  }
  fs.writeFileSync(bankFile, JSON.stringify(existing, null, 2), 'utf8');
  log(`已擷取 ${groups.length} 題 → ${bankFile}`);
  log('把每題的 answerText 填成正確選項文字（可只填前 10 個字），跑 run 時就會依文字比對作答。');
  console.log(JSON.stringify(Object.fromEntries(Object.entries(existing.questions).map(([k, v]) => [k, v.stem])), null, 2).slice(0, 2000));
  cdp.close();
  return 0;
}

// ---------- report ----------
async function cmdReport(opts) {
  const config = readConfig(opts);
  const store = new Store(path.resolve(ROOT, config.dataDir || 'data'));
  const accounts = store.accounts();
  const prog = store.progress();
  const goal = Number(prog.goal || config.goalPerAccount || 60);
  const finished = accounts.filter((a) => Number(a.used || 0) >= Number(a.target || goal));
  const total = accounts.reduce((s, a) => s + Number(a.used || 0), 0);
  console.log('\n=== 進度 ===');
  console.log(`帳號：${accounts.length} 個，已達標 ${finished.length} 個`);
  console.log(`累積次數：${total}`);
  console.log(`當前：${prog.account || '-'}  ${prog.used ?? '-'} / ${goal}`);
  console.log(`最後更新：${prog.updatedAt || '-'}`);
  if (account0(accounts)) {
    console.log('\n最近 5 個帳號：');
    for (const a of accounts.slice(-5)) console.log(`  ${a.email}  ${a.used || 0}/${a.target || goal}  ${a.finishedAt ? '已完成' : ''}`);
  }
  const statusFile = path.join(ROOT, config.dataDir || 'data', 'status.txt');
  if (fs.existsSync(statusFile)) {
    const age = (Date.now() - fs.statSync(statusFile).mtimeMs) / 1000;
    console.log(`\n心跳：${age.toFixed(0)} 秒前  ${fs.readFileSync(statusFile, 'utf8').trim()}`);
  }
  console.log('');
  return 0;
}
const account0 = (a) => Array.isArray(a) && a.length > 0;

// ---------- stop ----------
async function cmdStop(opts) {
  const config = readConfig(opts);
  const store = new Store(path.resolve(ROOT, config.dataDir || 'data'));
  store.stop();
  log('已寫入 stop.flag，執行中的流程會在下一步停下');
  return 0;
}

// ---------- new-site ----------
function cmdNewSite(opts) {
  const name = opts._[1];
  if (!name) throw new Error('用法：node run.mjs new-site <名稱> --url https://example.com --match example.com');
  const tpl = readJson(path.resolve(ROOT, 'sites/_template.json'), {});
  const site = {
    ...tpl,
    id: name,
    name: opts.title || name,
    baseUrl: opts.url || 'https://example.com',
    matchUrl: opts.match || (opts.url ? new URL(opts.url).host.replace(/\./g, '\\.') : 'example\\.com'),
  };
  const file = path.resolve(ROOT, 'sites', `${name}.json`);
  if (fs.existsSync(file) && !opts.force) throw new Error(`${file} 已存在（要覆蓋請加 --force）`);
  fs.writeFileSync(file, JSON.stringify(site, null, 2), 'utf8');
  log(`已建立 ${file}`);
  log('下一步：把 JSON 裡的 url / selector / steps 改成新站實際的元素，再跑 node run.mjs probe --site ' + name);
  return 0;
}

// ---------- run ----------
async function cmdRun(opts) {
  const config = readConfig(opts);
  const site = readSite(opts, config);
  const dataDir = path.resolve(ROOT, config.dataDir || 'data');
  ensureDir(dataDir);
  const store = new Store(dataDir);
  store.clearStop();

  const goal = Number(opts.goal || site.goalPerAccount || config.goalPerAccount || 60);
  const maxRounds = Number(opts.max || 0); // 0 = 不限（直到帳號滿或使用者停止）
  const gapSec = Number(opts.gap || site.gapSec || config.gapSec || 150);
  const dryRun = !!opts['dry-run'];
  const port = Number(opts.port || config.cdpPort || 9333);

  log(`站點：${site.name || site.id} | 目標 ${goal} 次/帳號 | 間隔 ${gapSec}s${dryRun ? ' | DRY RUN（不送出任何寫入動作）' : ''}`);

  if (!opts['no-chrome']) {
    await ensureChrome({
      port,
      userDataDir: path.resolve(ROOT, config.userDataDir || 'data/profile'),
      chromePath: config.chromePath,
      log,
    });
  }
  const cdp = await Cdp.attach({ port, match: site.matchUrl, log });
  const human = createHuman(cdp, {
    dryRun,
    log,
    dwellMs: config.human?.dwellMs ?? 1000,
    answerGapMs: config.human?.answerGapMs ?? 1000,
    countdownSec: config.human?.countdownSec ?? 5,
  });
  const baseVars = varsFor(site, config);
  const flow = new Flow({ cdp, human, vars: baseVars, dataDir, dryRun, log });
  const mailbox = new Mailbox(config.mailboxes, { dataDir, log });

  const usedEmails = new Set(store.accounts().map((a) => a.email));
  const pickNick = () => {
    const pool = config.nicknames?.length ? config.nicknames : ['自動化小幫手'];
    for (let i = 0; i < 200; i++) {
      const n = pool[Math.floor(Math.random() * pool.length)];
      const taken = new Set(store.accounts().map((a) => a.nickname));
      if (!taken.has(n)) return n;
      const withNum = `${n}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 10);
      if (!taken.has(withNum)) return withNum;
    }
    return randomPet().slice(0, 10);
  };

  async function readProgress(vars) {
    if (!site.progress?.read) return Number(vars.used || 0);
    await flow.run(site.progress.read, vars);
    const v = Number(flow.vars[site.progress.var || 'used']);
    return Number.isFinite(v) ? v : 0;
  }

  async function ensureLogin(account) {
    const vars = varsFor(site, config, account);
    flow.vars = { ...flow.vars, ...vars };
    const probe = site.login?.probe;
    if (probe) {
      const ok = await cdp.evalSafe(interpolate(probe, vars));
      if (ok) {
        log(`已登入（${account.email}）`);
        return true;
      }
    }
    for (let i = 1; i <= 3; i++) {
      try {
        log(`登入中（第 ${i} 次）${account.email}`);
        await flow.run(site.login.steps, vars);
        log('登入成功');
        return true;
      } catch (e) {
        log(`登入失敗：${e.message}`);
        await sleep(2000);
      }
    }
    return false;
  }

  async function createAccount() {
    if (!site.signup?.steps?.length) return null;
    const email = await mailbox.next();
    if (usedEmails.has(email)) throw new Error(`信箱重複：${email}`);
    usedEmails.add(email);
    const nickname = pickNick();
    const password = config.defaults?.password || 'ChangeMe12345';
    const account = {
      email,
      nickname,
      password,
      used: 0,
      target: goal,
      site: site.id,
      createdAt: new Date().toISOString(),
    };
    const vars = varsFor(site, config, account);
    flow.vars = { ...flow.vars, ...vars };
    log(`註冊新帳號：${email} / ${nickname}`);
    try {
      await flow.run(site.signup.steps, vars);
    } catch (e) {
      store.log({ event: 'signup-failed', email, error: e.message });
      log(`註冊失敗：${e.message}`);
    }
    store.addAccount(account);
    return account;
  }

  let rounds = 0;
  let failures = 0;
  try {
    while (!store.stopped()) {
      let account = store.nextAccount(goal);
      if (!account) {
        account = await createAccount();
        if (!account) {
          log('沒有可用帳號，且此站沒有註冊流程 → 結束');
          break;
        }
      }

      flow.vars = { ...flow.vars, ...varsFor(site, config, account) };
      store.setState({ account: account.email, site: site.id });
      store.status(`帳號 ${account.email} 開始`);

      const logged = await ensureLogin(account);
      if (!logged) {
        failures++;
        store.updateAccount(account.email, { disabled: true, note: '登入失敗 3 次' });
        store.log({ event: 'login-failed', email: account.email });
        if (failures >= 3) {
          log('連續登入失敗 3 個帳號，停止');
          break;
        }
        continue;
      }

      let used = await readProgress(varsFor(site, config, account));
      log(`目前進度 ${used} / ${goal}`);
      store.updateAccount(account.email, { used });
      store.setProgress({ site: site.id, account: account.email, used, goal });

      while (used < goal && !store.stopped()) {
        if (maxRounds && rounds >= maxRounds) {
          log(`已達 --max ${maxRounds} 輪，停止`);
          store.status('達到 max 輪數，停止');
          cdp.close();
          return 0;
        }
        rounds++;
        const t0 = Date.now();
        log(`=== 第 ${rounds} 輪（${account.email} ${used}/${goal}）===`);
        store.status(`第 ${rounds} 輪 ${account.email} ${used}/${goal}`);
        try {
          await flow.run(site.unit.steps, varsFor(site, config, account));
          used = await readProgress(varsFor(site, config, account));
          store.updateAccount(account.email, { used });
          store.setProgress({ site: site.id, account: account.email, used, goal, rounds });
          store.log({ event: 'unit-ok', round: rounds, email: account.email, used, ms: Date.now() - t0 });
          log(`第 ${rounds} 輪完成 → ${used} / ${goal}（剩 ${Math.max(0, goal - used)}）`);
        } catch (e) {
          if (e.stopFlow) break;
          failures++;
          store.log({ event: 'unit-fail', round: rounds, email: account.email, error: e.message });
          log(`第 ${rounds} 輪失敗：${e.message}`);
          store.status(`第 ${rounds} 輪失敗：${e.message}`);
          if (failures >= Number(config.maxFailures || 8)) {
            log(`連續失敗 ${failures} 次，停止`);
            break;
          }
          await sleep(5000);
        }
        if (used < goal && !store.stopped()) {
          log(`休息 ${gapSec} 秒…`);
          await sleep(gapSec * 1000);
        }
      }

      if (used >= goal) {
        store.updateAccount(account.email, { finishedAt: new Date().toISOString() });
        store.log({ event: 'account-done', email: account.email, used });
        log(`帳號 ${account.email} 已達 ${goal} 次`);
        failures = 0;
      }
      if (maxRounds && rounds >= maxRounds) break;
    }
  } finally {
    cdp.close();
  }
  log('結束');
  return 0;
}

// ---------- main ----------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const cmd = opts._[0] || 'doctor';
  switch (cmd) {
    case 'doctor':
      return await cmdDoctor(opts);
    case 'probe':
      return await cmdProbe(opts);
    case 'run':
      return await cmdRun(opts);
    case 'report':
      return await cmdReport(opts);
    case 'stop':
      return await cmdStop(opts);
    case 'teach':
      return await cmdTeach(opts);
    case 'new-site':
      return cmdNewSite(opts);
    default:
      console.log(`未知指令：${cmd}\n可用：doctor | probe | run | report | stop | teach | new-site`);
      return 2;
  }
}

main()
  .then((code) => process.exit(code || 0))
  .catch((e) => {
    console.error(`\n[錯誤] ${e.message}`);
    process.exit(1);
  });
