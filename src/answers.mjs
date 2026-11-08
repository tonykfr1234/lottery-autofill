// answers.mjs — 題庫（答案庫）載入與比對
// 支援三種格式：
//   1) { "questions": { "12": { "answerText": "...", "answerId": "q_12_2" } } }   ← isafe kb.json 原格式
//   2) { "byStem": [ { "stem": "題幹關鍵字", "answer": "..." } ] }
//   3) { "12": "答案文字" }
import fs from 'node:fs';

export const norm = (s) =>
  String(s || '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[「」『』"'“”‘’（）()【】\[\]、，,。.：:；;！!？?]/g, '')
    .trim();

export function loadBank(file) {
  if (!file || !fs.existsSync(file)) return { questions: {}, byStem: [], raw: {} };
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`題庫 JSON 解析失敗：${file} → ${e.message}`);
  }
  const bank = { questions: {}, byStem: [], raw: json };
  if (json.questions && typeof json.questions === 'object') {
    for (const [qid, v] of Object.entries(json.questions)) {
      if (typeof v === 'string') {
        bank.questions[qid] = { text: v, answerId: null };
      } else if (v && typeof v === 'object') {
        const text = v.answerText || v.answer || '';
        if (text || v.answerId) bank.questions[qid] = { text: String(text), answerId: v.answerId || null };
      }
    }
  }
  if (Array.isArray(json.byStem)) {
    for (const row of json.byStem) {
      if (row && row.stem && (row.answer || row.answerText)) {
        bank.byStem.push({ stem: String(row.stem), answer: String(row.answer || row.answerText), answerId: row.answerId || null });
      }
    }
  }
  for (const [k, v] of Object.entries(json)) {
    if (k === 'questions' || k === 'byStem') continue;
    if (typeof v === 'string') bank.questions[k] = { text: v, answerId: null };
  }
  return bank;
}

function similar(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.includes(y) || y.includes(x)) return 0.9;
  let best = 0;
  const short = x.length <= y.length ? x : y;
  const long = x.length <= y.length ? y : x;
  for (let i = 0; i < short.length; i++) {
    for (let len = best + 1; i + len <= short.length; len++) {
      if (long.includes(short.slice(i, i + len))) best = len;
      else break;
    }
  }
  return best / short.length;
}

/**
 * 找出這一組題目該選哪個選項。
 * group = { qid, stem, options:[{id,value,text}] }
 * 回傳 { text, value, id, how } 或 null
 */
export function pickByBank(bank, group) {
  const candidates = [];

  const direct = bank.questions[group.qid];
  if (direct) candidates.push({ answer: direct.text, answerId: direct.answerId, how: 'qid' });

  if (!candidates.length && bank.byStem.length) {
    let best = { score: 0, answer: '', answerId: null };
    for (const row of bank.byStem) {
      const s = similar(row.stem, group.stem);
      if (s > best.score) best = { score: s, answer: row.answer, answerId: row.answerId };
    }
    if (best.score >= 0.55) candidates.push({ answer: best.answer, answerId: best.answerId, how: `stem(${best.score.toFixed(2)})` });
  }

  for (const c of candidates) {
    // 1) answerId 直接命中（最精準：選項 id 就是當初記錄的那個 input）
    if (c.answerId) {
      const byId = group.options.find((o) => o.id === c.answerId);
      if (byId) return { text: byId.text, value: byId.value, id: byId.id, how: `${c.how}+id` };
    }
    // 2) 文字比對（選項順序與 value 洗牌都不影響）
    if (c.answer) {
      const hit =
        group.options.find((o) => similar(o.text, c.answer) >= 0.8) ||
        group.options.find((o) => {
          const a = norm(c.answer);
          const t = norm(o.text);
          return a.slice(0, 18) === t.slice(0, 18);
        });
      if (hit) return { text: hit.text, value: hit.value, id: hit.id, how: c.how };
    }
  }
  return null;
}
