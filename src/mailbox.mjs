// mailbox.mjs — 新信箱來源（換站換規則時，帳號來源也一起可換）
// provider: plusAlias | manual | cloudflare
import fs from 'node:fs';
import path from 'node:path';

const PETS = [
  'corgi', 'shibainu', 'husky', 'akita', 'munchkin', 'bengal', 'pomeranian', 'samoyed',
  'beagle', 'ragdoll', 'poodle', 'tabby', 'dachshund', 'persian', 'bichon', 'chihuahua',
  'maltese', 'spitz', 'dalmatian', 'sphynx', 'collie', 'papillon', 'terrier', 'koala',
  'ferret', 'hedgehog', 'hamster', 'otter', 'seal', 'lynx',
];

export function randomDigits(n = 5) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

export function randomPet() {
  return PETS[Math.floor(Math.random() * PETS.length)] + randomDigits(5);
}

export class Mailbox {
  constructor(cfg = {}, { dataDir = 'data', log = () => {} } = {}) {
    this.cfg = cfg;
    this.dataDir = dataDir;
    this.log = log;
    this.queueFile = path.join(dataDir, 'mailboxes.txt');
    this.usedFile = path.join(dataDir, 'mailboxes.used.txt');
  }

  get provider() {
    return this.cfg.provider || 'plusAlias';
  }

  used() {
    try {
      return new Set(fs.readFileSync(this.usedFile, 'utf8').split(/\r?\n/).filter(Boolean));
    } catch {
      return new Set();
    }
  }

  markUsed(email) {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.appendFileSync(this.usedFile, email + '\n', 'utf8');
  }

  async next() {
    let email = null;
    if (this.provider === 'plusAlias') email = this.nextPlusAlias();
    else if (this.provider === 'manual') email = this.nextManual();
    else if (this.provider === 'cloudflare') email = await this.nextCloudflare();
    else throw new Error(`未知的 mailbox provider：${this.provider}`);
    if (!email) throw new Error('取不到新信箱，請檢查 config.mailboxes 設定');
    this.markUsed(email);
    this.log(`新信箱：${email}`);
    return email;
  }

  nextPlusAlias() {
    const base = this.cfg.plusAlias?.base;
    if (!base || !base.includes('@')) throw new Error('mailboxes.plusAlias.base 需要是完整 email，例如 you@gmail.com');
    const seen = this.used();
    for (let i = 0; i < 50; i++) {
      const [user, domain] = base.split('@');
      const tag = (this.cfg.plusAlias?.tag || randomPet()).toLowerCase();
      const candidate = `${user}+${tag}@${domain}`;
      if (!seen.has(candidate)) return candidate;
    }
    throw new Error('plusAlias 產生信箱重複太多次');
  }

  nextManual() {
    if (!fs.existsSync(this.queueFile)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(this.queueFile, '# 一行一個信箱，取用後會移到 mailboxes.used.txt\n', 'utf8');
      throw new Error(`請先把要用的信箱填進 ${this.queueFile}`);
    }
    const lines = fs.readFileSync(this.queueFile, 'utf8').split(/\r?\n/);
    const i = lines.findIndex((l) => l.trim() && !l.trim().startsWith('#'));
    if (i < 0) throw new Error(`${this.queueFile} 沒有可用信箱`);
    const email = lines[i].trim();
    lines.splice(i, 1);
    fs.writeFileSync(this.queueFile, lines.join('\n'), 'utf8');
    return email;
  }

  /** Cloudflare Email Routing：建一條 literal 規則轉寄到固定信箱 */
  async nextCloudflare() {
    const cf = this.cfg.cloudflare || {};
    const token = process.env.CF_API_TOKEN || cf.apiToken;
    if (!token) throw new Error('cloudflare provider 需要環境變數 CF_API_TOKEN（或在 config 設 cloudflare.apiToken，不建議進版控）');
    if (!cf.zoneId || !cf.domain || !cf.destination) throw new Error('cloudflare provider 需要 zoneId / domain / destination');

    const local = (cf.localPart || randomPet()).toLowerCase();
    const address = `${local}@${cf.domain}`;
    const body = {
      name: `autofill-${local}`,
      enabled: true,
      matchers: [{ type: 'literal', field: 'to', value: address }],
      actions: [{ type: 'forward', value: [cf.destination] }],
    };
    const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${cf.zoneId}/email/routing/rules`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const msg = JSON.stringify(json.errors || json).slice(0, 300);
      throw new Error(`建立 Cloudflare 規則失敗：${msg}`);
    }
    this.log(`Cloudflare 規則已建立 → ${address} → ${cf.destination}`);
    return address;
  }
}
