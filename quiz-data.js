// quiz-data.js
// Dữ liệu, kiểm tra hợp lệ, chấm điểm và đọc đề hàng loạt. Không đụng tới giao diện nên kiểm thử được riêng.
//
// Mô hình dữ liệu của một bộ đề:
//   { id, type: 'mcq' | 'tf' | 'short', name, className, questions: [...], updatedAt }
// Câu hỏi theo loại:
//   mcq:   { q, options: [4 chuỗi], answer: 0..3, explain }
//   tf:    { kind: 'single', q, answer: true|false, explain }
//          { kind: 'multi',  q, items: [{ text, answer }] x4, explain }
//   short: { q, answers: [các đáp án chấp nhận], explain }

export const TYPES = ['mcq', 'tf', 'short'];

const str = (v, max = 3000) =>
  (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);

/* ------------------------------------------------------------------ */
/* Làm sạch dữ liệu (dùng khi đọc từ máy, từ đám mây, từ file .json)    */
/* ------------------------------------------------------------------ */

export function sanitizeQuestion(q, type) {
  if (!q || typeof q !== 'object') return null;
  const out = { q: str(q.q), explain: str(q.explain) };
  if (type === 'mcq') {
    if (!Array.isArray(q.options)) return null;
    out.options = [0, 1, 2, 3].map(i => str(q.options[i], 500));
    out.answer = Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4 ? q.answer : null;
  } else if (type === 'tf') {
    if (q.kind === 'multi') {
      if (!Array.isArray(q.items)) return null;
      out.kind = 'multi';
      out.items = [0, 1, 2, 3].map(i => {
        const it = q.items[i] || {};
        return { text: str(it.text, 500), answer: typeof it.answer === 'boolean' ? it.answer : null };
      });
    } else {
      out.kind = 'single';
      out.answer = typeof q.answer === 'boolean' ? q.answer : null;
    }
  } else if (type === 'short') {
    out.answers = (Array.isArray(q.answers) ? q.answers : [])
      .map(a => str(a, 200).trim())
      .filter(Boolean)
      .slice(0, 20);
  } else {
    return null;
  }
  return out;
}

export function sanitizeSet(s) {
  if (!s || typeof s !== 'object') return null;
  if (!TYPES.includes(s.type)) return null;
  if (!Array.isArray(s.questions)) return null;
  const questions = s.questions
    .slice(0, 500)
    .map(q => sanitizeQuestion(q, s.type))
    .filter(Boolean);
  const idOk = typeof s.id === 'number' || (typeof s.id === 'string' && s.id.length > 0);
  return {
    id: idOk ? s.id : Date.now() + Math.floor(Math.random() * 1000),
    type: s.type,
    name: str(s.name, 200).trim() || 'Bộ đề không tên',
    className: str(s.className, 50),
    questions,
    updatedAt: Number(s.updatedAt) || Date.now(),
  };
}

/** Câu hỏi đã đủ thông tin để chơi chưa? */
export function isComplete(q, type) {
  if (!q || !q.q || !q.q.trim()) return false;
  if (type === 'mcq') {
    return q.options.length === 4 && q.options.every(o => o && o.trim()) && q.answer !== null;
  }
  if (type === 'tf') {
    if (q.kind === 'multi') {
      return q.items.length === 4 && q.items.every(it => it.text && it.text.trim() && typeof it.answer === 'boolean');
    }
    return typeof q.answer === 'boolean';
  }
  if (type === 'short') return q.answers.length > 0;
  return false;
}

/* ------------------------------------------------------------------ */
/* Chấm điểm                                                          */
/* ------------------------------------------------------------------ */

// Thang điểm đúng/sai 4 ý (kiểu đề thi): đúng 0,1,2,3,4 ý -> 0; 0,1; 0,25; 0,5; 1
export const MULTI_SCALE = [0, 0.1, 0.25, 0.5, 1];

export function scoreMulti(correctCount) {
  return MULTI_SCALE[Math.max(0, Math.min(4, correctCount))];
}

export function normalizeShort(s, ignoreAccents = true) {
  let t = String(s == null ? '' : s).trim().toLowerCase();
  if (ignoreAccents) t = t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  else t = t.normalize('NFC');
  t = t.replace(/[−–—]/g, '-').replace(/[×·⋅]/g, '*'); // dấu trừ và dấu nhân gõ bằng ký tự đặc biệt
  t = t.replace(/\s+/g, ''); // bỏ mọi khoảng trắng
  t = t.replace(/[.。]+$/, ''); // bỏ dấu chấm kết câu
  return t;
}

function asNumber(t) {
  // 1.000 hoặc 1.234.567 (có thể kèm phần thập phân sau dấu phẩy): dấu chấm là dấu ngăn cách hàng nghìn
  if (/^[-+]?\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(t)) return parseFloat(t.replace(/\./g, '').replace(',', '.'));
  return /^[-+]?\d+(?:[.,]\d+)?$/.test(t) ? parseFloat(t.replace(',', '.')) : null;
}

/** So khớp câu trả lời ngắn: bỏ qua hoa/thường, khoảng trắng, (tùy chọn) dấu; số thì so theo giá trị (0,5 = 0.5). */
export function checkShort(input, answers, ignoreAccents = true) {
  const a = normalizeShort(input, ignoreAccents);
  if (!a) return false;
  const na = asNumber(a);
  return answers.some(ans => {
    const b = normalizeShort(ans, ignoreAccents);
    if (a === b) return true;
    const nb = asNumber(b);
    return na !== null && nb !== null && Math.abs(na - nb) < 1e-9;
  });
}

/* ------------------------------------------------------------------ */
/* Đọc đề hàng loạt từ văn bản                                         */
/* ------------------------------------------------------------------ */

const ANS_RE = /^\s*(?:(?:Đáp án|Dap an|Answer)\b\s*[:：.\-]?|(?:Đ\/A|ĐA|Key)\s*[:：.\-])\s*(.*)$/i;
const EXPL_RE = /^\s*(?:Giải thích|Giai thich|Lời giải|Hướng dẫn|HD|Explain)\b\s*[:：.\-]?\s*(.*)$/i;
const OPT_RE = /^\s*(\*)?\s*([A-Da-d])\s*[.)]\s*(.*)$/;
const TOKEN_RE = /(^|[^\p{L}])(Đúng|Sai|Đ|S|T|F|True|False)(?![\p{L}])/giu;
const toBool = s => /^(đúng|đ|t|true)$/iu.test(s);

const PAIR_RE = /(\d{1,3})\s*[.:)\-–]?\s*([A-Da-d])(?![\p{L}])/gu;

/** Tách bảng đáp án gom cuối đề (nếu có). Trả về { lines: các dòng còn lại, key: { '1': 'A', ... } }. */
function extractKey(lines) {
  const key = {};
  const keep = [];
  let inKey = false;
  const grab = txt => { for (const m of txt.matchAll(PAIR_RE)) key[String(parseInt(m[1], 10))] = m[2].toUpperCase(); };
  for (const ln of lines) {
    const t = ln.trim();
    if (inKey) { grab(t); continue; }
    if (/^(?:Bảng\s+)?Đáp án\s*:?\s*$/i.test(t)) { inKey = true; continue; }
    const m = t.match(ANS_RE);
    if (m && [...m[1].matchAll(PAIR_RE)].length >= 3) { grab(m[1]); continue; }
    keep.push(ln);
  }
  return { lines: keep, key };
}

function parseBlock(b, type, keyLetter) {
  const qLines = [];
  const opts = [];
  const expl = [];
  let ansRaw = null;
  let mode = 'q';

  for (const ln of b.lines) {
    const t = ln.trim();
    if (!t) continue;
    let m;
    if ((m = t.match(ANS_RE))) { ansRaw = m[1]; mode = 'a'; continue; }
    if ((m = t.match(EXPL_RE))) { if (m[1]) expl.push(m[1]); mode = 'e'; continue; }
    if (mode === 'e') { expl.push(t); continue; }
    if (mode === 'a') { ansRaw += ' ' + t; continue; }
    if ((m = t.match(OPT_RE))) { opts.push({ star: !!m[1], label: m[2], text: m[3].trim() }); mode = 'o'; continue; }
    if (mode === 'o' && opts.length) { opts[opts.length - 1].text += ' ' + t; continue; }
    qLines.push(t);
  }

  // Với trả lời ngắn, dòng "a. ..." (nếu có) chỉ là một phần của đề
  if (type === 'short') {
    opts.forEach(o => qLines.push(`${o.label}) ${o.text}`));
    opts.length = 0;
  }

  const qText = qLines.join('\n').replace(/\*\*/g, '').trim();
  const explain = expl.join('\n').trim();
  if (!qText) return { err: 'thiếu nội dung câu hỏi' };

  if (type === 'mcq') {
    if (opts.length !== 4) return { err: `đọc được ${opts.length} đáp án (cần đủ 4: A, B, C, D)` };
    const byLetter = {};
    opts.forEach(o => { byLetter[o.label.toUpperCase()] = o; });
    const arr = ['A', 'B', 'C', 'D'].map(l => byLetter[l]);
    if (arr.some(x => !x)) return { err: 'các đáp án phải được gắn nhãn A, B, C, D' };
    let ans = null;
    if (ansRaw) {
      const m = ansRaw.match(/(?:^|[^\p{L}])([A-Da-d])(?![\p{L}])/u);
      if (m) ans = 'ABCD'.indexOf(m[1].toUpperCase());
    }
    if (ans === null) {
      const stars = arr.map((o, i) => (o.star ? i : -1)).filter(i => i >= 0);
      if (stars.length === 1) ans = stars[0];
    }
    if (ans === null && keyLetter) ans = 'ABCD'.indexOf(keyLetter);
    if (ans === null || ans < 0) return { err: 'thiếu đáp án đúng (thêm dòng "Đáp án: B", đánh dấu * trước đáp án đúng, hoặc có bảng ĐÁP ÁN ở cuối đề)' };
    return { q: { q: qText, options: arr.map(o => o.text), answer: ans, explain } };
  }

  if (type === 'tf') {
    let toks = ansRaw ? [...ansRaw.matchAll(TOKEN_RE)].map(m => toBool(m[2])) : [];
    if (ansRaw && toks.length <= 1) {
      // Viết liền: "ĐSĐĐ" hoặc "Đ-S-Đ-Đ"
      const compact = ansRaw.replace(/[\s,;.\-]/g, '');
      if (/^[ĐS]{2,6}$/i.test(compact)) toks = [...compact].map(c => /^đ$/i.test(c));
    }
    const marker = /\s*[\[(（]\s*(Đúng|Sai|Đ|S|T|F)\s*[\])）]\s*$/iu;

    if (opts.length > 0) {
      if (opts.length !== 4) return { err: `đọc được ${opts.length} ý (cần đủ 4 ý a, b, c, d)` };
      const items = opts.map(o => ({ text: o.text, answer: null }));
      items.forEach((it, i) => {
        const mm = it.text.match(marker);
        if (mm) { it.answer = toBool(mm[1]); it.text = it.text.slice(0, mm.index).trim(); }
        else if (opts[i].star) it.answer = true;
      });
      if (toks.length === 4) items.forEach((it, i) => { if (it.answer === null) it.answer = toks[i]; });
      if (items.some(it => it.answer === null) && opts.some(o => o.star)) {
        items.forEach(it => { if (it.answer === null) it.answer = false; });
      }
      if (items.some(it => it.answer === null)) {
        return { err: 'thiếu đáp án Đ/S cho các ý (ví dụ dòng "Đáp án: Đ S Đ S")' };
      }
      return { q: { kind: 'multi', q: qText, items, explain } };
    }

    let val = toks.length ? toks[0] : null;
    let text = qText;
    if (val === null) {
      const mm = qText.match(marker);
      if (mm) { val = toBool(mm[1]); text = qText.slice(0, mm.index).trim(); }
    }
    if (val === null) return { err: 'thiếu đáp án (dòng "Đáp án: Đúng" hoặc "Đáp án: Sai")' };
    return { q: { kind: 'single', q: text, answer: val, explain } };
  }

  // short
  const answers = (ansRaw || '').split(/[;|]/).map(s => s.trim()).filter(Boolean);
  if (!answers.length) return { err: 'thiếu đáp án (dòng "Đáp án: ...", nhiều đáp án cách nhau bằng dấu ;)' };
  return { q: { q: qText, answers, explain } };
}

/**
 * Đọc nhiều câu hỏi từ một khối văn bản.
 * Trả về { questions, warnings }. Câu thiếu thông tin bị bỏ qua và có cảnh báo kèm số câu.
 */
export function parseBulk(text, type) {
  const warnings = [];
  const raw = String(text || '').replace(/\r/g, '').split('\n');

  // Tách các dòng chứa nhiều lựa chọn trên cùng một dòng: "A. 4  B. 7  C. 9  D. 15"
  const lines = [];
  const ek = extractKey(raw);
  for (const ln of ek.lines) {
    if (/^\s*\*?\s*[A-Da-d]\s*[.)]\s/.test(ln) && /\s\*?[B-Db-d]\s*[.)]\s/.test(ln)) {
      ln.split(/\s+(?=\*?[A-Da-d]\s*[.)]\s)/).forEach(p => lines.push(p));
    } else {
      lines.push(ln);
    }
  }

  const hasCau = lines.some(l => /^\s*(?:\*\*)?\s*(?:Câu|Cau|Question)\s*\d+/i.test(l));
  const startRe = hasCau
    ? /^\s*(?:\*\*)?\s*(?:Câu|Cau|Question)\s*(\d+)\s*[.:)\-]?\s*(.*)$/i
    : /^\s*(\d+)\s*(?:\)\s*|\.\s+)(.*)$/;

  const blocks = [];
  let cur = null;
  for (const ln of lines) {
    const m = ln.match(startRe);
    if (m) {
      cur = { num: m[1], lines: [m[2].replace(/\*\*\s*$/, '')] };
      blocks.push(cur);
    } else if (cur) {
      cur.lines.push(ln);
    }
  }
  if (!blocks.length) {
    warnings.push('Không tìm thấy câu hỏi nào. Mỗi câu cần bắt đầu bằng "Câu 1." (xem phần mẫu).');
  }

  const questions = [];
  for (const b of blocks) {
    const r = parseBlock(b, type, ek.key[String(parseInt(b.num, 10))]);
    if (r.err) warnings.push(`Câu ${b.num} bị bỏ qua: ${r.err}.`);
    else questions.push(r.q);
  }
  return { questions, warnings };
}

/* ------------------------------------------------------------------ */
/* Mẫu nhập hàng loạt và bộ đề mẫu                                      */
/* ------------------------------------------------------------------ */

export const BULK_TEMPLATES = {
  mcq: `Câu 1. Số nào sau đây là số nguyên tố?
A. 1
B. 9
C. 13
D. 15
Đáp án: C
Giải thích: 13 chỉ có hai ước là 1 và 13.

Câu 2. Phân tích 12 ra thừa số nguyên tố ta được:
A. $2 \\cdot 6$
B. $3 \\cdot 4$
*C. $2^2 \\cdot 3$
D. $2 \\cdot 3^2$`,
  tf: `Câu 1. 7 là số nguyên tố.
Đáp án: Đúng
Giải thích: 7 chỉ có hai ước là 1 và 7.

Câu 2. Cho các số 2, 9, 11, 15. Xét tính đúng sai của các phát biểu:
a) 2 là số nguyên tố.
b) 9 là số nguyên tố.
c) 11 là số nguyên tố.
d) 15 là hợp số.
Đáp án: Đ S Đ Đ
Giải thích: 9 = 3 . 3 nên là hợp số.`,
  short: `Câu 1. Có bao nhiêu số nguyên tố nhỏ hơn 10?
Đáp án: 4
Giải thích: Đó là 2, 3, 5, 7.

Câu 2. Phân tích 30 ra thừa số nguyên tố (viết dạng 2.3.5).
Đáp án: 2.3.5 ; 2*3*5 ; 2x3x5
Giải thích: 30 = 2 . 3 . 5.`,
};

export const SAMPLES = {
  mcq: {
    name: 'Mẫu: Số nguyên tố (Toán 6)',
    questions: [
      { q: 'Số nào sau đây là số nguyên tố?', options: ['1', '9', '13', '15'], answer: 2, explain: '13 chỉ có hai ước là 1 và 13.' },
      { q: 'Số nguyên tố chẵn duy nhất là số nào?', options: ['0', '2', '4', '6'], answer: 1, explain: 'Mọi số chẵn lớn hơn 2 đều chia hết cho 2 nên là hợp số.' },
      { q: 'Hợp số là số tự nhiên lớn hơn 1 và…', options: ['chỉ có hai ước', 'có nhiều hơn hai ước', 'bằng 0', 'không có ước nào'], answer: 1, explain: 'Hợp số có nhiều hơn hai ước.' },
      { q: 'Phân tích số 12 ra thừa số nguyên tố ta được:', options: ['$2 \\cdot 6$', '$3 \\cdot 4$', '$2^2 \\cdot 3$', '$2 \\cdot 3^2$'], answer: 2, explain: '$12 = 4 \\cdot 3 = 2^2 \\cdot 3$.' },
      { q: 'Số nào sau đây là hợp số?', options: ['2', '3', '5', '21'], answer: 3, explain: '$21 = 3 \\cdot 7$ có nhiều hơn hai ước.' },
    ],
  },
  tf: {
    name: 'Mẫu: Số nguyên tố (Toán 6)',
    questions: [
      { kind: 'single', q: '7 là số nguyên tố.', answer: true, explain: '7 chỉ có hai ước là 1 và 7.' },
      { kind: 'single', q: 'Số 1 là số nguyên tố.', answer: false, explain: 'Số 1 không là số nguyên tố cũng không là hợp số.' },
      { kind: 'single', q: 'Mọi số nguyên tố đều là số lẻ.', answer: false, explain: '2 là số nguyên tố chẵn.' },
      { kind: 'single', q: 'Số 15 là hợp số.', answer: true, explain: '15 chia hết cho 1, 3, 5, 15.' },
      {
        kind: 'multi',
        q: 'Cho các số 2, 9, 11, 15. Xét tính đúng sai của các phát biểu sau:',
        items: [
          { text: '2 là số nguyên tố.', answer: true },
          { text: '9 là số nguyên tố.', answer: false },
          { text: '11 là số nguyên tố.', answer: true },
          { text: '15 là hợp số.', answer: true },
        ],
        explain: '$9 = 3 \\cdot 3$ nên 9 là hợp số.',
      },
    ],
  },
  short: {
    name: 'Mẫu: Số nguyên tố (Toán 6)',
    questions: [
      { q: 'Có bao nhiêu số nguyên tố nhỏ hơn 10?', answers: ['4'], explain: 'Đó là 2, 3, 5, 7.' },
      { q: 'Số nguyên tố nhỏ nhất là số nào?', answers: ['2'], explain: '' },
      { q: 'Phân tích 30 ra thừa số nguyên tố (viết dạng 2.3.5).', answers: ['2.3.5', '2*3*5', '2x3x5', '2·3·5'], explain: '$30 = 2 \\cdot 3 \\cdot 5$.' },
      { q: 'Số nguyên tố nhỏ nhất lớn hơn 10 là số nào?', answers: ['11'], explain: '' },
      { q: 'Số 7 có bao nhiêu ước?', answers: ['2', 'hai'], explain: 'Hai ước là 1 và 7.' },
    ],
  },
};
