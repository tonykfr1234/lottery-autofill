// store.mjs — 狀態、帳號、進度、日誌
import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, obj) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(obj, null, 2), 'utf8');
}

export class Store {
  constructor(dataDir) {
    this.dir = ensureDir(dataDir);
    this.accountsFile = path.join(this.dir, 'accounts.json');
    this.progressFile = path.join(this.dir, 'progress.json');
    this.logFile = path.join(this.dir, 'run.jsonl');
    this.statusFile = path.join(this.dir, 'status.txt');
    this.stateFile = path.join(this.dir, 'state.json');
  }

  accounts() {
    return readJson(this.accountsFile, []);
  }

  saveAccounts(list) {
    writeJson(this.accountsFile, list);
  }

  addAccount(acc) {
    const list = this.accounts();
    list.push(acc);
    this.saveAccounts(list);
    return acc;
  }

  /** 取得下一個還沒到目標次數的帳號 */
  nextAccount(goal) {
    const list = this.accounts();
    return list.find((a) => !a.disabled && Number(a.used || 0) < Number(a.target || goal)) || null;
  }

  updateAccount(email, patch) {
    const list = this.accounts();
    const i = list.findIndex((a) => a.email === email);
    if (i < 0) return null;
    list[i] = { ...list[i], ...patch, updatedAt: new Date().toISOString() };
    this.saveAccounts(list);
    return list[i];
  }

  progress() {
    return readJson(this.progressFile, {});
  }

  setProgress(patch) {
    const p = { ...this.progress(), ...patch, updatedAt: new Date().toISOString() };
    writeJson(this.progressFile, p);
    return p;
  }

  log(obj) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...obj });
    fs.appendFileSync(this.logFile, line + '\n', 'utf8');
  }

  status(text) {
    try {
      fs.writeFileSync(this.statusFile, `${new Date().toISOString()} ${text}\n`, 'utf8');
    } catch {
      /* ignore */
    }
  }

  state() {
    return readJson(this.stateFile, {});
  }

  setState(patch) {
    const s = { ...this.state(), ...patch };
    writeJson(this.stateFile, s);
    return s;
  }

  stop() {
    writeJson(path.join(this.dir, 'stop.flag'), { at: new Date().toISOString() });
  }

  clearStop() {
    const f = path.join(this.dir, 'stop.flag');
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }

  stopped() {
    return fs.existsSync(path.join(this.dir, 'stop.flag'));
  }
}

export function fmtTs(d = new Date()) {
  return d.toTimeString().slice(0, 8);
}
