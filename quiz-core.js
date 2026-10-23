// quiz-core.js
// Giao diện dùng chung cho 3 trò: trắc nghiệm 4 đáp án (mcq), đúng/sai (tf), trả lời ngắn (short).
// Mỗi trang HTML chỉ cần đặt window.GAME_TYPE rồi nạp file này.
import {
  sanitizeSet, isComplete, checkShort, scoreMulti, parseBulk, BULK_TEMPLATES, SAMPLES,
} from './quiz-data.js';

// Đồng bộ đám mây là tùy chọn: nếu không nạp được (mạng trường chặn...) thì chạy chế độ chỉ lưu trên máy.
let sync = {
  onStatus(cb) { cb({ state: 'nocfg' }); },
  onData() {},
  save() {},
  remove() {},
  toggleAuth() {},
};
try {
  ({ sync } = await import('./sync.js'));
} catch (e) {
  console.warn('Đồng bộ đám mây không khả dụng, dùng chế độ lưu trên máy.', e);
}

const TYPE = window.GAME_TYPE;
const META = {
  mcq: {
    title: 'Trắc nghiệm 4 đáp án',
    icon: 'fa-list-ol',
    blurb: 'Mỗi câu có 4 đáp án A, B, C, D. Chiếu lên lớp và bấm hiện đáp án, hoặc cho học sinh tự chọn và tính điểm.',
  },
  tf: {
    title: 'Trắc nghiệm đúng sai',
    icon: 'fa-circle-check',
    blurb: 'Hai kiểu câu hỏi: một mệnh đề (Đúng/Sai) và câu có 4 ý a, b, c, d (chọn Đ/S cho từng ý).',
  },
  short: {
    title: 'Trả lời ngắn',
    icon: 'fa-keyboard',
    blurb: 'Học sinh gõ đáp án ngắn (số hoặc từ). Chấm tự động và chấp nhận nhiều cách viết.',
  },
}[TYPE];

/* ================================================================== */
/* Tiện ích                                                           */
/* ================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);

/** Tạo phần tử DOM. Nội dung luôn được gán bằng textContent nên dữ liệu nhập vào không thể chèn mã. */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  const late = {};
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') late[k] = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : String(kid));
  }
  Object.assign(el, late);
  return el;
}

const icon = name => h('i', { class: 'fa-solid ' + name });

function typeset(el) {
  if (window.renderMathInElement) {
    try {
      window.renderMathInElement(el, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
      });
    } catch (e) { /* bỏ qua lỗi công thức */ }
  }
}

function setText(el, text) {
  el.textContent = text;
  typeset(el);
  return el;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const fmt = n => String(Math.round(n * 100) / 100).replace('.', ',');

function toast(msg, kind = 'ok') {
  const t = h('div', {
    class: `fixed bottom-4 left-1/2 -translate-x-1/2 z-[100] max-w-[92vw] px-5 py-3 rounded-2xl font-bold shadow-xl text-white ${kind === 'err' ? 'bg-rose-500' : 'bg-emerald-500'}`,
    text: msg,
  });
  document.body.append(t);
  setTimeout(() => t.remove(), 3500);
}

const BTN = 'font-black py-2.5 px-5 rounded-2xl text-white inline-flex items-center justify-center gap-2 transition-all active:shadow-none active:translate-y-[5px] disabled:opacity-40 disabled:pointer-events-none';
const BTN_PINK = `${BTN} bg-pink-500 hover:bg-pink-600 shadow-[0_5px_0_#be185d]`;
const BTN_BLUE = `${BTN} bg-indigo-500 hover:bg-indigo-600 shadow-[0_5px_0_#4338ca]`;
const BTN_GREEN = `${BTN} bg-emerald-500 hover:bg-emerald-600 shadow-[0_5px_0_#047857]`;
const BTN_ORANGE = `${BTN} bg-orange-400 hover:bg-orange-500 shadow-[0_5px_0_#c2410c]`;
const BTN_GHOST = 'bg-white hover:bg-pink-50 text-pink-600 font-bold py-2 px-4 rounded-xl border-2 border-pink-200 inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-40 disabled:pointer-events-none';
const BTN_GRAY = 'bg-slate-400 hover:bg-slate-500 text-white font-bold py-2 px-4 rounded-xl inline-flex items-center justify-center gap-2';
const INPUT = 'w-full border-2 border-pink-200 rounded-xl px-3 py-2 font-semibold text-gray-800 focus:outline-none focus:border-pink-500 bg-white';

/* ---------- Âm thanh và hiệu ứng ---------- */

let muted = false;
let actx = null;

function beep(seq) {
  if (muted) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    let t = actx.currentTime;
    seq.forEach(([f, d]) => {
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      o.connect(g);
      g.connect(actx.destination);
      g.gain.setValueAtTime(0.15, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + d);
      o.start(t);
      o.stop(t + d);
      t += d * 0.9;
    });
  } catch (e) { /* trình duyệt không cho phát âm thanh */ }
}
const sfx = {
  ok: () => beep([[523, 0.12], [659, 0.12], [784, 0.22]]),
  part: () => beep([[440, 0.15], [523, 0.2]]),
  bad: () => beep([[247, 0.22], [196, 0.35]]),
  fanfare: () => beep([[523, 0.15], [659, 0.15], [784, 0.15], [1047, 0.4]]),
};

function spawnFlowers() {
  const emojis = ['🌸', '🌺', '🌼', '✨', '🎉'];
  for (let i = 0; i < 40; i++) {
    const f = h('div', { class: 'flower', text: emojis[Math.floor(Math.random() * emojis.length)] });
    f.style.left = Math.random() * 100 + 'vw';
    f.style.animationDuration = Math.random() * 2 + 3 + 's';
    f.style.animationDelay = Math.random() * 0.5 + 's';
    document.body.append(f);
    setTimeout(() => f.remove(), 5500);
  }
}

/* ================================================================== */
/* Thư viện bộ đề (lưu trên máy + đồng bộ đám mây)                      */
/* ================================================================== */

const LS_KEY = 'quiz_lib';
const SET_KEY = 'quiz_settings';

function loadLocal() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_KEY) || '[]');
    return Array.isArray(arr) ? arr.map(sanitizeSet).filter(Boolean) : [];
  } catch (e) { return []; }
}
function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(library)); } catch (e) { /* bộ nhớ đầy hoặc bị chặn */ }
}

let library = loadLocal();

const defaultOpts = { mode: 'present', shuffleQ: false, shuffleA: false, timeLimit: 0, ignoreAccents: true };
function loadOpts() {
  try { return { ...defaultOpts, ...JSON.parse(localStorage.getItem(SET_KEY) || '{}') }; } catch (e) { return { ...defaultOpts }; }
}
function saveOpts(o) {
  try { localStorage.setItem(SET_KEY, JSON.stringify(o)); } catch (e) { /* bỏ qua */ }
}

function upsertSet(set) {
  const i = library.findIndex(s => String(s.id) === String(set.id));
  if (i >= 0) library[i] = set; else library.unshift(set);
  saveLocal();
  sync.save(set);
}

function deleteSet(id) {
  library = library.filter(s => String(s.id) !== String(id));
  saveLocal();
  sync.remove(id);
}

// Khi dữ liệu đám mây thay đổi (hoặc lần đầu đăng nhập)
sync.onData((cloud, uid) => {
  const flag = 'quiz_merged_' + uid;
  let merged = false;
  try { merged = !!localStorage.getItem(flag); } catch (e) { /* bỏ qua */ }
  const sets = cloud.map(sanitizeSet).filter(Boolean);
  if (!merged) {
    // Lần đầu một tài khoản đăng nhập trên máy này: đưa các bộ đề đang có trên máy lên đám mây
    const ids = new Set(sets.map(s => String(s.id)));
    const localOnly = library.filter(s => !ids.has(String(s.id)));
    localOnly.forEach(s => sync.save(s));
    sets.push(...localOnly);
    try { localStorage.setItem(flag, '1'); } catch (e) { /* bỏ qua */ }
  }
  library = sets.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  saveLocal();
  if (currentScreen === 'home') renderHome();
});

let syncStatus = { state: 'nocfg' };
sync.onStatus(s => {
  syncStatus = s;
  document.querySelectorAll('.sync-badge').forEach(fillSyncBadge);
});

function fillSyncBadge(el) {
  el.innerHTML = '';
  const s = syncStatus;
  let text = '';
  let btn = null;
  if (s.state === 'nocfg') text = 'Chưa bật đồng bộ đám mây: dữ liệu chỉ lưu trên máy này.';
  else if (s.state === 'out') {
    text = 'Chưa đăng nhập: dữ liệu chỉ lưu trên máy này.';
    btn = h('button', { class: BTN_GHOST + ' !py-1 text-sm', onclick: () => sync.toggleAuth() }, h('i', { class: 'fa-brands fa-google' }), ' Đăng nhập để đồng bộ');
  } else if (s.state === 'in') {
    text = 'Đã đồng bộ đám mây' + (s.email ? ': ' + s.email : '');
    btn = h('button', { class: BTN_GHOST + ' !py-1 text-sm', onclick: () => sync.toggleAuth() }, icon('fa-right-from-bracket'), ' Đăng xuất');
  } else if (s.state === 'error') {
    text = `Lỗi đồng bộ (${s.code}).` + (s.code === 'permission-denied'
      ? ' Cần cập nhật quy tắc Firestore để cho phép lưu bộ đề (xem hướng dẫn).' : '');
    btn = h('button', { class: BTN_GHOST + ' !py-1 text-sm', onclick: () => sync.toggleAuth() }, icon('fa-right-from-bracket'), ' Đăng xuất');
  }
  el.append(
    h('span', { class: 'text-xs md:text-sm font-bold text-sky-800 flex items-center gap-2' }, icon('fa-cloud'), text),
    btn
  );
}

function makeSyncBadge() {
  const el = h('div', { class: 'sync-badge flex flex-wrap items-center gap-2 bg-sky-50 border border-sky-200 rounded-xl px-3 py-1.5' });
  fillSyncBadge(el);
  return el;
}

/* ================================================================== */
/* Khung trang và điều hướng                                           */
/* ================================================================== */

let screen = null;
let currentScreen = '';
let play = null;

function buildShell() {
  const app = $('#app');
  app.innerHTML = '';
  app.className = 'min-h-screen w-full p-2 md:p-5 flex justify-center';
  screen = h('div', { id: 'screen', class: 'flex-1 flex flex-col' });
  app.append(
    h('div', {
      class: 'w-full max-w-6xl bg-white/90 backdrop-blur-md rounded-[1.5rem] md:rounded-[2rem] shadow-2xl border-4 border-white p-3 md:p-6 flex flex-col relative',
    }, screen)
  );
}

function classNum(name) {
  const m = String(name).match(/\d+/);
  return m ? parseInt(m[0], 10) : 999;
}

/* ================================================================== */
/* Màn hình thư viện                                                   */
/* ================================================================== */

function renderHome() {
  stopTimer();
  play = null;
  currentScreen = 'home';
  screen.innerHTML = '';

  const mine = library.filter(s => s.type === TYPE);

  const fileIn = h('input', {
    type: 'file', accept: '.json,application/json', class: 'hidden',
    onchange: e => { const f = e.target.files[0]; e.target.value = ''; if (f) importLibraryFile(f); },
  });

  screen.append(
    h('div', { class: 'flex flex-wrap items-center justify-between gap-3 mb-4' },
      h('a', { href: './index.html', class: BTN_GHOST }, icon('fa-house'), ' Trang chủ'),
      makeSyncBadge()),
    h('div', { class: 'text-center mb-5' },
      h('div', { class: 'inline-flex w-16 h-16 md:w-20 md:h-20 rounded-3xl bg-gradient-to-br from-pink-400 to-purple-400 text-white items-center justify-center text-3xl md:text-4xl shadow-lg mb-3' }, icon(META.icon)),
      h('h1', { class: 'text-2xl md:text-4xl font-black text-pink-600', text: META.title }),
      h('p', { class: 'text-gray-500 font-semibold mt-1 max-w-2xl mx-auto', text: META.blurb })),
    h('div', { class: 'grid grid-cols-2 md:flex md:flex-wrap md:justify-center gap-3 mb-5' },
      h('button', { class: BTN_PINK + ' col-span-2 md:col-span-1', onclick: () => openEditor(null) }, icon('fa-pen-to-square'), ' Soạn bộ đề mới'),
      h('button', { class: BTN_BLUE + ' col-span-2 md:col-span-1', onclick: () => openEditor(null, { openImport: true }) }, icon('fa-file-word'), ' Tạo từ Word / văn bản'),
      h('button', { class: BTN_GHOST, onclick: () => fileIn.click() }, icon('fa-file-import'), ' Nhập .json'),
      h('button', { class: BTN_GHOST, onclick: exportLibrary }, icon('fa-file-export'), ' Xuất .json'),
      fileIn),
    buildLibraryList(mine)
  );
}

function buildLibraryList(mine) {
  if (!mine.length) {
    return h('div', { class: 'rounded-3xl border-4 border-dashed border-pink-200 bg-pink-50/60 p-6 md:p-10 text-center' },
      h('p', { class: 'text-pink-600 font-black text-lg mb-1', text: 'Chưa có bộ đề nào' }),
      h('p', { class: 'text-gray-500 font-semibold mb-4', text: 'Soạn bộ đề mới, dán/tải đề từ Word, hoặc thử ngay với bộ đề mẫu.' }),
      h('button', { class: BTN_ORANGE, onclick: addSample }, icon('fa-wand-magic-sparkles'), ' Dùng bộ đề mẫu (Toán 6: số nguyên tố)'));
  }

  const groups = new Map();
  mine.forEach(s => {
    const k = s.className || 'Chưa phân loại';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  });
  const keys = [...groups.keys()].sort((a, b) => classNum(a) - classNum(b));

  return h('div', { class: 'flex flex-col gap-3' }, keys.map(k => {
    const items = groups.get(k);
    const body = h('div', { class: 'flex flex-col gap-2 p-3 bg-orange-50/50' }, items.map(setCard));
    const det = h('details', { class: 'bg-white rounded-2xl border-2 border-orange-200 overflow-hidden shadow-sm', open: true },
      h('summary', { class: 'bg-orange-100 px-4 py-3 cursor-pointer font-black text-orange-700 flex items-center gap-2 hover:bg-orange-200 transition-colors' },
        icon('fa-folder'), ' ', k,
        h('span', { class: 'bg-orange-500 text-white text-xs px-2 py-0.5 rounded-full ml-1', text: String(items.length) })),
      body);
    return det;
  }));
}

function setCard(s) {
  const date = new Date(s.updatedAt || Date.now()).toLocaleDateString('vi-VN');
  return h('div', { class: 'bg-white p-3 rounded-2xl border-2 border-orange-100 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 hover:border-orange-300 transition-colors' },
    h('div', { class: 'min-w-0 flex-1 cursor-pointer', onclick: () => renderSetup(s) },
      h('div', { class: 'font-black text-orange-700 truncate', text: s.name }),
      h('div', { class: 'text-xs text-gray-500 font-semibold mt-0.5', text: `${s.questions.length} câu • cập nhật ${date}` })),
    h('div', { class: 'flex gap-2 shrink-0' },
      h('button', { class: 'bg-blue-100 text-blue-700 hover:bg-blue-500 hover:text-white px-3 py-2 rounded-lg font-bold text-sm flex items-center gap-1 transition-colors', onclick: () => renderSetup(s) }, icon('fa-play'), ' Chơi'),
      h('button', { class: 'bg-amber-100 text-amber-700 hover:bg-amber-500 hover:text-white px-3 py-2 rounded-lg font-bold text-sm flex items-center gap-1 transition-colors', onclick: () => openEditor(s) }, icon('fa-pen'), ' Sửa'),
      h('button', {
        class: 'bg-red-50 text-red-500 hover:bg-red-500 hover:text-white px-3 py-2 rounded-lg font-bold text-sm flex items-center gap-1 transition-colors',
        onclick: () => {
          if (confirm(`Xóa bộ đề "${s.name}"? Việc này không hoàn tác được.`)) { deleteSet(s.id); renderHome(); toast('Đã xóa bộ đề.'); }
        },
      }, icon('fa-trash-can'), ' Xóa')));
}

function addSample() {
  const sm = SAMPLES[TYPE];
  const set = sanitizeSet({
    id: Date.now(), type: TYPE, name: sm.name, className: 'Lớp 6', questions: sm.questions, updatedAt: Date.now(),
  });
  upsertSet(set);
  renderSetup(set);
}

function exportLibrary() {
  if (!library.length) { toast('Thư viện đang trống, chưa có gì để xuất.', 'err'); return; }
  const blob = new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'thu_vien_tro_choi.json' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast('Đã xuất toàn bộ bộ đề (gồm cả các loại trò chơi khác).');
}

function importLibraryFile(file) {
  file.text().then(txt => {
    let arr;
    try { arr = JSON.parse(txt); } catch (e) { toast('File không đúng định dạng .json.', 'err'); return; }
    if (!Array.isArray(arr)) { toast('File không chứa danh sách bộ đề.', 'err'); return; }
    const sets = arr.map(sanitizeSet).filter(Boolean);
    if (!sets.length) { toast('Không có bộ đề hợp lệ trong file (file ô chữ không dùng ở đây).', 'err'); return; }
    let added = 0;
    sets.forEach(s => {
      const dup = library.some(x => String(x.id) === String(s.id) ||
        (x.type === s.type && x.name === s.name && x.questions.length === s.questions.length));
      if (!dup) { library.push(s); sync.save(s); added++; }
    });
    saveLocal();
    renderHome();
    toast(`Đã nhập ${added} bộ đề mới (bỏ qua ${sets.length - added} bộ trùng).`);
  });
}

/* ================================================================== */
/* Màn hình chuẩn bị chơi                                              */
/* ================================================================== */

function renderSetup(set) {
  stopTimer();
  play = null;
  currentScreen = 'setup';
  const opts = loadOpts();
  const playable = set.questions.filter(q => isComplete(q, set.type)).length;
  screen.innerHTML = '';

  const modeCard = (val, title, desc, ic) => h('label', { class: 'block cursor-pointer' },
    h('input', { type: 'radio', name: 'mode', value: val, class: 'peer sr-only', checked: opts.mode === val }),
    h('div', { class: 'h-full rounded-2xl border-4 border-pink-100 bg-white p-4 transition-all peer-checked:border-pink-500 peer-checked:bg-pink-50' },
      h('div', { class: 'font-black text-pink-600 flex items-center gap-2', }, icon(ic), title),
      h('div', { class: 'text-sm text-gray-600 font-semibold mt-1', text: desc })));

  const check = (id, label, checked) => h('label', { class: 'flex items-center gap-3 font-bold text-gray-700 cursor-pointer' },
    h('input', { type: 'checkbox', id, checked, class: 'w-5 h-5 accent-pink-500' }), label);

  const timeSel = h('select', { id: 'opt-time', class: INPUT + ' max-w-[16rem]' },
    [[0, 'Không giới hạn'], [10, '10 giây'], [15, '15 giây'], [20, '20 giây'], [30, '30 giây'], [45, '45 giây'], [60, '1 phút'], [90, '1 phút 30'], [120, '2 phút']]
      .map(([v, l]) => h('option', { value: String(v), selected: Number(opts.timeLimit) === v }, l)));

  screen.append(
    h('div', { class: 'flex items-center justify-between gap-3 mb-4' },
      h('button', { class: BTN_GHOST, onclick: renderHome }, icon('fa-arrow-left'), ' Thư viện'),
      h('button', { class: BTN_GHOST, onclick: () => openEditor(set) }, icon('fa-pen'), ' Sửa bộ đề')),
    h('div', { class: 'text-center mb-5' },
      h('h2', { class: 'text-2xl md:text-3xl font-black text-pink-600', text: set.name }),
      h('p', { class: 'text-gray-500 font-semibold mt-1', text: `${META.title} • ${playable} câu` + (playable < set.questions.length ? ` (${set.questions.length - playable} câu chưa đầy đủ sẽ bị bỏ qua)` : '') })),
    h('div', { class: 'max-w-3xl w-full mx-auto flex flex-col gap-4' },
      h('div', {},
        h('div', { class: 'font-black text-gray-700 mb-2', text: 'Chế độ chơi' }),
        h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-3' },
          modeCard('present', 'Chiếu lớp', 'Giáo viên bấm "Hiện đáp án" để công bố. Chữ to, không tính điểm.', 'fa-chalkboard-user'),
          modeCard('solo', 'Tự làm', 'Chọn/nhập đáp án, có phản hồi ngay và tính điểm cuối bài.', 'fa-user-graduate'))),
      h('div', { class: 'flex flex-col gap-3 bg-white rounded-2xl border-2 border-pink-100 p-4' },
        check('opt-shuffle-q', 'Xáo trộn thứ tự câu hỏi', opts.shuffleQ),
        TYPE === 'mcq' ? check('opt-shuffle-a', 'Xáo trộn thứ tự đáp án A, B, C, D', opts.shuffleA) : null,
        TYPE === 'short' ? check('opt-accents', 'Bỏ qua dấu tiếng Việt khi chấm (chế độ tự làm)', opts.ignoreAccents) : null,
        h('div', {}, h('div', { class: 'font-bold text-gray-700 mb-1', text: 'Thời gian mỗi câu' }), timeSel)),
      h('button', {
        class: BTN_PINK + ' text-xl py-4', disabled: playable === 0,
        onclick: () => {
          const o = {
            mode: ($('input[name="mode"]:checked') || {}).value || 'present',
            shuffleQ: $('#opt-shuffle-q').checked,
            shuffleA: $('#opt-shuffle-a') ? $('#opt-shuffle-a').checked : false,
            ignoreAccents: $('#opt-accents') ? $('#opt-accents').checked : true,
            timeLimit: Number($('#opt-time').value) || 0,
          };
          saveOpts(o);
          startPlay(set, o);
        },
      }, icon('fa-play'), ' BẮT ĐẦU'))
  );
}

/* ================================================================== */
/* Chơi                                                                */
/* ================================================================== */

function startPlay(set, cfg, customQs) {
  const base = customQs || set.questions.filter(q => isComplete(q, set.type));
  const qs = base.map(q => JSON.parse(JSON.stringify(q)));
  if (!qs.length) { toast('Bộ đề chưa có câu nào đầy đủ để chơi.', 'err'); return; }
  if (!customQs) {
    if (cfg.shuffleQ) shuffle(qs);
    if (set.type === 'mcq' && cfg.shuffleA) {
      qs.forEach(q => {
        const perm = shuffle([0, 1, 2, 3]);
        q.options = perm.map(i => q.options[i]);
        q.answer = perm.indexOf(q.answer);
      });
    }
  }
  play = {
    set, cfg, type: set.type, mode: cfg.mode, qs,
    i: 0, score: 0, results: [], custom: !!customQs,
    revealed: false, locked: false, timerId: null, endAt: 0,
    els: [], rows: [], selItems: [null, null, null, null], ansBox: null, input: null,
  };
  renderPlay();
}

function renderPlay() {
  const P = play;
  const q = P.qs[P.i];
  currentScreen = 'play';
  P.revealed = false;
  P.locked = false;
  P.els = [];
  P.rows = [];
  P.selItems = [null, null, null, null];
  P.ansBox = null;
  P.input = null;
  screen.innerHTML = '';

  const limit = P.cfg.timeLimit;
  const qText = h('div', {
    id: 'qtext', class: 'font-black text-gray-800 leading-snug whitespace-pre-line',
    style: 'font-size:clamp(1.25rem,3vw,2.6rem)',
  });
  setText(qText, q.q);

  screen.append(
    h('div', { class: 'flex items-center gap-2 md:gap-3 mb-2' },
      h('button', {
        class: BTN_GHOST + ' shrink-0',
        onclick: () => { if (confirm('Thoát khỏi bài đang chơi?')) { stopTimer(); renderSetup(P.set); } },
      }, icon('fa-xmark'), h('span', { class: 'hidden md:inline', text: ' Thoát' })),
      h('div', { class: 'font-black text-pink-600 whitespace-nowrap', text: `Câu ${P.i + 1}/${P.qs.length}` }),
      h('div', { class: 'flex-1 h-3 bg-pink-100 rounded-full overflow-hidden' },
        h('div', { class: 'h-full bg-pink-400 transition-all', style: `width:${(P.i / P.qs.length) * 100}%` })),
      P.mode === 'solo' ? h('div', { id: 'score-live', class: 'font-black text-indigo-600 whitespace-nowrap', text: 'Điểm: ' + fmt(P.score) }) : null,
      limit ? h('div', { id: 'tleft', class: 'font-black text-gray-600 w-10 text-right', text: String(limit) }) : null,
      h('button', { class: BTN_GHOST + ' shrink-0 !px-3', title: 'Bật/tắt âm thanh', onclick: toggleMute }, icon(muted ? 'fa-volume-xmark' : 'fa-volume-high')),
      h('button', { class: BTN_GHOST + ' shrink-0 !px-3', title: 'Toàn màn hình', onclick: toggleFullscreen }, icon('fa-expand'))),
    limit ? h('div', { class: 'h-2 bg-gray-100 rounded-full overflow-hidden mb-3' },
      h('div', { id: 'tbar', class: 'h-full bg-emerald-400', style: 'width:100%' })) : h('div', { class: 'mb-2' }),
    h('div', { class: 'bg-gradient-to-br from-pink-50 to-purple-50 border-2 border-pink-200 rounded-3xl p-4 md:p-8 mb-4 text-center shadow-inner' }, qText),
    h('div', { id: 'ans-area', class: 'flex-1' }),
    h('div', { id: 'feedback', class: 'hidden mt-4 text-center font-black rounded-2xl py-2 px-3 text-lg md:text-2xl' }),
    h('div', { id: 'explain', class: 'hidden mt-4 rounded-2xl bg-yellow-50 border-2 border-yellow-300 p-4 text-yellow-900 font-semibold' }),
    h('div', { id: 'foot', class: 'mt-4 flex flex-wrap items-center justify-between gap-3' })
  );

  const area = $('#ans-area');
  if (P.type === 'mcq') buildMcq(area, q);
  else if (P.type === 'tf' && q.kind === 'multi') buildMulti(area, q);
  else if (P.type === 'tf') buildSingle(area, q);
  else buildShort(area, q);

  updateFooter();
  startTimer();
}

/* ---------- Thanh dưới cùng ---------- */

function updateFooter() {
  const P = play;
  const q = P.qs[P.i];
  const foot = $('#foot');
  if (!foot) return;
  foot.innerHTML = '';
  const last = P.i === P.qs.length - 1;
  const nextBtn = () => h('button', { class: BTN_PINK, onclick: goNext }, last ? 'Kết thúc ' : 'Câu tiếp ', icon('fa-arrow-right'));

  if (P.mode === 'present') {
    foot.append(
      h('button', { class: BTN_GHOST, disabled: P.i === 0, onclick: goPrev }, icon('fa-arrow-left'), ' Câu trước'),
      h('div', { class: 'hidden md:block text-xs text-gray-400 font-semibold', text: 'Phím Space / Enter / → để đi tiếp, ← để quay lại' }),
      P.revealed ? nextBtn() : h('button', { class: BTN_BLUE, onclick: revealNow }, icon('fa-eye'), ' Hiện đáp án'));
    return;
  }

  if (P.locked) { foot.append(h('div'), nextBtn()); return; }
  if (P.type === 'tf' && q.kind === 'multi') {
    foot.append(h('div', { class: 'text-gray-400 font-semibold', text: 'Chọn Đúng/Sai cho từng ý' }),
      h('button', { class: BTN_GREEN, onclick: submitMulti }, icon('fa-check'), ' Chốt đáp án'));
  } else if (P.type === 'short') {
    foot.append(h('div'), h('button', { class: BTN_GREEN, onclick: submitShort }, icon('fa-check'), ' Kiểm tra'));
  } else {
    foot.append(h('div', { class: 'text-gray-400 font-semibold', text: 'Chọn một đáp án' }));
  }
}

/* ---------- Hiện đáp án (chế độ chiếu lớp) ---------- */

function revealNow() {
  const P = play;
  if (!P || P.revealed) return;
  const q = P.qs[P.i];
  P.revealed = true;
  stopTimer();
  if (P.type === 'mcq') revealMcq(null);
  else if (P.type === 'tf' && q.kind === 'multi') revealMulti();
  else if (P.type === 'tf') revealSingle(null);
  else revealShort();
  showExplain();
  updateFooter();
}

function showExplain() {
  const P = play;
  const q = P.qs[P.i];
  const box = $('#explain');
  if (!box || !q.explain || !q.explain.trim()) return;
  box.classList.remove('hidden');
  box.innerHTML = '';
  const body = h('div', { class: 'whitespace-pre-line', style: 'font-size:clamp(1rem,1.8vw,1.5rem)' });
  setText(body, q.explain);
  box.append(h('div', { class: 'font-black mb-1', text: '💡 Giải thích' }), body);
}

function showFeedback(score, timeout) {
  const box = $('#feedback');
  if (!box) return;
  box.classList.remove('hidden', 'bg-emerald-100', 'text-emerald-700', 'bg-rose-100', 'text-rose-700', 'bg-amber-100', 'text-amber-700');
  if (score >= 1) { box.classList.add('bg-emerald-100', 'text-emerald-700'); box.textContent = '✓ Chính xác! +1 điểm'; }
  else if (score > 0) { box.classList.add('bg-amber-100', 'text-amber-700'); box.textContent = `Đúng một phần: +${fmt(score)} điểm`; }
  else { box.classList.add('bg-rose-100', 'text-rose-700'); box.textContent = timeout ? '⏰ Hết giờ!' : '✗ Chưa đúng'; }
}

/** Ghi kết quả một câu ở chế độ tự làm rồi hiện đáp án. */
function finishAnswer(score, given, revealFn, timeout) {
  const P = play;
  P.locked = true;
  P.revealed = true;
  stopTimer();
  P.results[P.i] = { score, given };
  P.score += score;
  const live = $('#score-live');
  if (live) live.textContent = 'Điểm: ' + fmt(P.score);
  revealFn();
  showFeedback(score, timeout);
  showExplain();
  updateFooter();
  if (score >= 1) sfx.ok(); else if (score > 0) sfx.part(); else sfx.bad();
}

/* ---------- Trắc nghiệm 4 đáp án ---------- */

const MCQ_COLORS = [
  'bg-rose-50 border-rose-300 text-rose-900',
  'bg-sky-50 border-sky-300 text-sky-900',
  'bg-amber-50 border-amber-300 text-amber-900',
  'bg-emerald-50 border-emerald-300 text-emerald-900',
];
const MCQ_BADGE = ['bg-rose-400', 'bg-sky-400', 'bg-amber-400', 'bg-emerald-400'];

function buildMcq(area, q) {
  const P = play;
  const grid = h('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4' });
  q.options.forEach((opt, i) => {
    const txt = h('span', { class: 'font-bold whitespace-pre-line flex-1', style: 'font-size:clamp(1rem,2.2vw,2rem)' });
    setText(txt, opt);
    const b = h('button', {
      class: `text-left flex items-center gap-3 md:gap-4 rounded-2xl border-4 p-3 md:p-5 transition-all ${MCQ_COLORS[i]}${P.mode === 'solo' ? ' hover:scale-[1.02]' : ' cursor-default'}`,
    },
      h('span', { class: `shrink-0 w-10 h-10 md:w-14 md:h-14 rounded-full text-white font-black flex items-center justify-center text-lg md:text-2xl ${MCQ_BADGE[i]}`, text: 'ABCD'[i] }),
      txt);
    if (P.mode === 'solo') b.addEventListener('click', () => answerMcq(i));
    grid.append(b);
    P.els.push(b);
  });
  area.append(grid);
}

function answerMcq(i) {
  const P = play;
  if (P.locked) return;
  const q = P.qs[P.i];
  finishAnswer(i === q.answer ? 1 : 0, i, () => revealMcq(i));
}

function revealMcq(chosen) {
  const P = play;
  const q = P.qs[P.i];
  P.els.forEach((b, i) => {
    if (i === q.answer) {
      b.classList.add('ring-8', 'ring-emerald-400', 'scale-[1.02]');
      b.append(h('span', { class: 'text-3xl md:text-5xl text-emerald-600 font-black', text: '✓' }));
    } else if (i === chosen) {
      b.classList.add('ring-8', 'ring-rose-400', 'opacity-70');
      b.append(h('span', { class: 'text-3xl md:text-5xl text-rose-600 font-black', text: '✗' }));
    } else {
      b.classList.add('opacity-40');
    }
  });
}

/* ---------- Đúng/sai: một mệnh đề ---------- */

function buildSingle(area, q) {
  const P = play;
  const wrap = h('div', { class: 'grid grid-cols-2 gap-3 md:gap-6' });
  [
    [true, 'ĐÚNG', 'bg-emerald-400 hover:bg-emerald-500 shadow-[0_8px_0_#059669]', 'fa-check'],
    [false, 'SAI', 'bg-rose-400 hover:bg-rose-500 shadow-[0_8px_0_#be123c]', 'fa-xmark'],
  ].forEach(([val, label, cls, ic]) => {
    const b = h('button', {
      class: `rounded-3xl py-6 md:py-12 text-white font-black flex flex-col items-center justify-center gap-2 transition-all ${cls}${P.mode === 'solo' ? '' : ' cursor-default'}`,
      style: 'font-size:clamp(1.5rem,4vw,3.5rem)',
    }, icon(ic), label);
    if (P.mode === 'solo') b.addEventListener('click', () => answerSingle(val));
    wrap.append(b);
    P.els.push({ val, b });
  });
  area.append(wrap);
}

function answerSingle(val) {
  const P = play;
  if (P.locked) return;
  const q = P.qs[P.i];
  finishAnswer(val === q.answer ? 1 : 0, val, () => revealSingle(val));
}

function revealSingle(chosen) {
  const P = play;
  const q = P.qs[P.i];
  P.els.forEach(({ val, b }) => {
    if (val === q.answer) b.classList.add('ring-8', 'ring-yellow-300', 'scale-[1.03]');
    else b.classList.add(chosen === val ? 'opacity-60' : 'opacity-30');
  });
}

/* ---------- Đúng/sai: 4 ý a, b, c, d ---------- */

const TOG = 'px-4 py-2 rounded-xl border-2 font-black transition-all ';
const TOG_OFF = TOG + 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50';

function buildMulti(area, q) {
  const P = play;
  const list = h('div', { class: 'flex flex-col gap-3' });
  q.items.forEach((it, k) => {
    const textEl = h('div', { class: 'flex-1 font-bold text-gray-800 whitespace-pre-line', style: 'font-size:clamp(1rem,2.2vw,2rem)' });
    setText(textEl, it.text);
    const badge = h('div', { class: 'hidden shrink-0 w-24 text-center rounded-xl font-black py-2 text-lg' });
    const bT = h('button', { class: TOG_OFF, onclick: () => pickItem(k, true) }, 'Đúng');
    const bF = h('button', { class: TOG_OFF, onclick: () => pickItem(k, false) }, 'Sai');
    const toggles = h('div', { class: 'flex gap-2 shrink-0' }, P.mode === 'solo' ? [bT, bF] : null);
    const row = h('div', { class: 'flex flex-col md:flex-row md:items-center gap-2 md:gap-4 bg-white border-4 border-pink-100 rounded-2xl p-3 md:p-4 transition-all' },
      h('div', { class: 'flex items-start gap-3 flex-1' },
        h('span', { class: 'font-black text-pink-500', style: 'font-size:clamp(1.1rem,2.4vw,2rem)', text: 'abcd'[k] + ')' }),
        textEl),
      toggles, badge);
    list.append(row);
    P.rows.push({ row, badge, bT, bF });
  });
  area.append(list);
}

function pickItem(k, val) {
  const P = play;
  if (P.locked) return;
  P.selItems[k] = val;
  const r = P.rows[k];
  r.bT.className = TOG + (val === true ? 'bg-emerald-500 text-white border-emerald-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-emerald-50');
  r.bF.className = TOG + (val === false ? 'bg-rose-500 text-white border-rose-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-rose-50');
}

function submitMulti(timeout) {
  const P = play;
  if (P.locked) return;
  const q = P.qs[P.i];
  const count = q.items.filter((it, k) => P.selItems[k] === it.answer).length;
  finishAnswer(scoreMulti(count), P.selItems.slice(), revealMulti, timeout === true);
}

function revealMulti() {
  const P = play;
  const q = P.qs[P.i];
  q.items.forEach((it, k) => {
    const r = P.rows[k];
    r.badge.classList.remove('hidden');
    r.badge.textContent = it.answer ? 'ĐÚNG' : 'SAI';
    r.badge.classList.add(...(it.answer ? ['bg-emerald-100', 'text-emerald-700'] : ['bg-rose-100', 'text-rose-700']));
    r.row.classList.remove('border-pink-100');
    if (P.mode === 'solo') {
      const mine = P.selItems[k];
      r.row.classList.add(mine === it.answer ? 'border-emerald-400' : 'border-rose-400');
    } else {
      r.row.classList.add(it.answer ? 'border-emerald-400' : 'border-rose-400');
    }
  });
}

/* ---------- Trả lời ngắn ---------- */

function buildShort(area, q) {
  const P = play;
  if (P.mode === 'present') {
    P.ansBox = h('div', {
      class: 'rounded-3xl border-4 border-dashed border-purple-300 bg-purple-50 p-6 md:p-10 text-center text-purple-300 font-black',
      style: 'font-size:clamp(2rem,6vw,5rem)', text: '?',
    });
    area.append(P.ansBox);
  } else {
    P.input = h('input', {
      type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false',
      class: 'w-full text-center font-black rounded-2xl border-4 border-purple-300 focus:border-pink-400 focus:outline-none py-4 px-4 bg-white',
      style: 'font-size:clamp(1.4rem,4vw,3rem)', placeholder: 'Nhập đáp án...',
    });
    P.ansBox = h('div', { class: 'hidden mt-4' });
    area.append(P.input, P.ansBox);
    setTimeout(() => { if (play === P && P.input) P.input.focus(); }, 50);
  }
}

function submitShort(timeout) {
  const P = play;
  if (P.locked) return;
  const q = P.qs[P.i];
  const val = P.input ? P.input.value : '';
  const ok = checkShort(val, q.answers, P.cfg.ignoreAccents);
  if (P.input) {
    P.input.disabled = true;
    P.input.classList.remove('border-purple-300');
    P.input.classList.add(ok ? 'border-emerald-400' : 'border-rose-400', ok ? 'bg-emerald-50' : 'bg-rose-50');
  }
  finishAnswer(ok ? 1 : 0, val, () => { if (!ok) revealShort(); }, timeout === true && !ok && !val.trim());
}

function revealShort() {
  const P = play;
  const q = P.qs[P.i];
  const box = P.ansBox;
  if (!box) return;
  box.className = (P.mode === 'present' ? '' : 'mt-4 ') + 'rounded-3xl border-4 border-purple-400 bg-purple-50 p-6 md:p-10 text-center font-black text-purple-800';
  box.removeAttribute('style');
  box.innerHTML = '';
  const main = h('div', { style: 'font-size:clamp(1.8rem,5vw,4rem)' });
  setText(main, q.answers[0]);
  box.append(h('div', { class: 'text-sm font-bold uppercase tracking-wider text-purple-500 mb-1', text: 'Đáp án' }), main);
  if (q.answers.length > 1) {
    const more = h('div', { class: 'text-sm md:text-lg font-semibold text-purple-600 mt-2' });
    setText(more, 'Cũng chấp nhận: ' + q.answers.slice(1).join('  ;  '));
    box.append(more);
  }
}

/* ---------- Đồng hồ ---------- */

function startTimer() {
  const P = play;
  stopTimer();
  const lim = P.cfg.timeLimit;
  if (!lim) return;
  P.endAt = Date.now() + lim * 1000;
  updateTimer();
  P.timerId = setInterval(updateTimer, 100);
}

function stopTimer() {
  if (play && play.timerId) { clearInterval(play.timerId); play.timerId = null; }
}

function updateTimer() {
  const P = play;
  if (!P) return;
  const lim = P.cfg.timeLimit;
  const left = Math.max(0, (P.endAt - Date.now()) / 1000);
  const bar = $('#tbar');
  const num = $('#tleft');
  if (bar) {
    bar.style.width = (left / lim) * 100 + '%';
    bar.className = 'h-full ' + (left <= 5 ? 'bg-rose-500' : left <= lim * 0.4 ? 'bg-amber-400' : 'bg-emerald-400');
  }
  if (num) {
    num.textContent = String(Math.ceil(left));
    num.classList.toggle('text-rose-600', left <= 5);
  }
  if (left <= 0) { stopTimer(); timeUp(); }
}

function timeUp() {
  const P = play;
  if (!P) return;
  const q = P.qs[P.i];
  if (P.mode === 'present') { revealNow(); sfx.bad(); return; }
  if (P.locked) return;
  if (P.type === 'tf' && q.kind === 'multi') submitMulti(true);
  else if (P.type === 'short') submitShort(true);
  else if (P.type === 'mcq') finishAnswer(0, null, () => revealMcq(null), true);
  else finishAnswer(0, null, () => revealSingle(null), true);
}

/* ---------- Chuyển câu ---------- */

function goNext() {
  const P = play;
  if (!P) return;
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  if (P.i < P.qs.length - 1) { P.i++; renderPlay(); } else { renderResult(); }
}

function goPrev() {
  const P = play;
  if (!P || P.i === 0) return;
  stopTimer();
  P.i--;
  renderPlay();
}

function toggleMute() {
  muted = !muted;
  if (currentScreen === 'play') {
    const btns = screen.querySelectorAll('button[title="Bật/tắt âm thanh"]');
    btns.forEach(b => { b.innerHTML = ''; b.append(icon(muted ? 'fa-volume-xmark' : 'fa-volume-high')); });
  }
}

function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen();
    else document.exitFullscreen();
  } catch (e) { /* trình duyệt không hỗ trợ */ }
}

/* ---------- Kết quả ---------- */

function answerText(q) {
  if (TYPE === 'mcq') return `${'ABCD'[q.answer]}. ${q.options[q.answer]}`;
  if (TYPE === 'tf') {
    return q.kind === 'multi'
      ? q.items.map((it, k) => `${'abcd'[k]}) ${it.answer ? 'Đ' : 'S'}`).join('   ')
      : q.answer ? 'Đúng' : 'Sai';
  }
  return q.answers.join('  ;  ');
}

function renderResult() {
  const P = play;
  stopTimer();
  currentScreen = 'result';
  screen.innerHTML = '';
  const n = P.qs.length;

  if (P.mode === 'present') {
    sfx.fanfare();
    screen.append(
      h('div', { class: 'flex-1 flex flex-col items-center justify-center text-center gap-4 py-10' },
        h('div', { class: 'text-7xl', text: '🎉' }),
        h('h2', { class: 'text-3xl md:text-5xl font-black text-pink-600', text: 'Hoàn thành!' }),
        h('p', { class: 'text-gray-500 font-semibold text-lg', text: `Đã đi hết ${n} câu của bộ đề "${P.set.name}".` }),
        h('div', { class: 'flex flex-wrap justify-center gap-3 mt-2' },
          h('button', { class: BTN_PINK, onclick: () => startPlay(P.set, P.cfg) }, icon('fa-rotate-right'), ' Chơi lại'),
          h('button', { class: BTN_GHOST, onclick: () => renderSetup(P.set) }, icon('fa-sliders'), ' Đổi cài đặt'),
          h('button', { class: BTN_GHOST, onclick: renderHome }, icon('fa-folder-open'), ' Thư viện'))));
    return;
  }

  const pct = Math.round((P.score / n) * 100);
  if (pct >= 80) { sfx.fanfare(); spawnFlowers(); } else if (pct >= 50) sfx.ok(); else sfx.bad();
  const wrong = [];
  P.qs.forEach((q, i) => { const r = P.results[i]; if (!r || r.score < 1) wrong.push({ q, i, r }); });

  const circle = h('div', {
    class: 'w-40 h-40 md:w-52 md:h-52 rounded-full flex items-center justify-center shadow-lg',
    style: `background:conic-gradient(#ec4899 ${pct}%, #fce7f3 0)`,
  }, h('div', { class: 'w-32 h-32 md:w-44 md:h-44 rounded-full bg-white flex flex-col items-center justify-center' },
    h('div', { class: 'text-4xl md:text-5xl font-black text-pink-600', text: pct + '%' }),
    h('div', { class: 'text-sm font-bold text-gray-500', text: `${fmt(P.score)}/${n} điểm` })));

  const msg = pct >= 80 ? 'Xuất sắc!' : pct >= 50 ? 'Khá lắm, cố gắng thêm nhé!' : 'Đừng nản, thử lại nhé!';

  screen.append(
    h('div', { class: 'flex flex-col items-center gap-4 py-4' },
      h('h2', { class: 'text-2xl md:text-4xl font-black text-pink-600', text: msg }),
      circle,
      h('div', { class: 'flex flex-wrap justify-center gap-3 mt-2' },
        h('button', { class: BTN_PINK, onclick: () => startPlay(P.set, P.cfg) }, icon('fa-rotate-right'), ' Chơi lại'),
        wrong.length ? h('button', { class: BTN_ORANGE, onclick: () => startPlay(P.set, { ...P.cfg, mode: 'solo' }, wrong.map(w => w.q)) }, icon('fa-arrow-rotate-left'), ` Làm lại ${wrong.length} câu chưa đúng`) : null,
        h('button', { class: BTN_GHOST, onclick: renderHome }, icon('fa-folder-open'), ' Thư viện'))),
    wrong.length ? h('div', { class: 'max-w-3xl w-full mx-auto mt-4' },
      h('h3', { class: 'font-black text-gray-700 mb-2', text: 'Các câu chưa đúng' }),
      h('div', { class: 'flex flex-col gap-2' }, wrong.map(({ q, i, r }) => {
        const qEl = h('div', { class: 'font-bold text-gray-800 whitespace-pre-line' });
        setText(qEl, `Câu ${i + 1}. ${q.q}`);
        const aEl = h('div', { class: 'text-emerald-700 font-black mt-1' });
        setText(aEl, 'Đáp án: ' + answerText(q));
        return h('div', { class: 'bg-rose-50 border-2 border-rose-200 rounded-2xl p-3' }, qEl, aEl,
          r && TYPE === 'short' && r.given ? h('div', { class: 'text-rose-600 font-semibold text-sm', text: 'Bạn trả lời: ' + r.given }) : null);
      }))) : null
  );
}

/* ================================================================== */
/* Phím tắt                                                            */
/* ================================================================== */

function mainAction() {
  const P = play;
  if (!P) return;
  if (document.activeElement && document.activeElement.blur && document.activeElement.tagName === 'BUTTON') document.activeElement.blur();
  if (P.mode === 'present') { if (P.revealed) goNext(); else revealNow(); }
  else if (P.locked) goNext();
}

document.addEventListener('keydown', e => {
  const P = play;
  if (!P || currentScreen !== 'play' || document.getElementById('editor-ov')) return;
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';
  const q = P.qs[P.i];

  if (P.mode === 'present') {
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') { e.preventDefault(); mainAction(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    return;
  }

  // Chế độ tự làm
  if (P.type === 'short' && !P.locked && e.key === 'Enter') { e.preventDefault(); submitShort(); return; }
  if (P.locked && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') && !typing) { e.preventDefault(); mainAction(); return; }
  if (typing || P.locked || e.key.length !== 1) return;
  const k = e.key.toLowerCase();
  if (P.type === 'mcq') {
    const idx = '1234'.indexOf(k) >= 0 ? '1234'.indexOf(k) : 'abcd'.indexOf(k);
    if (idx >= 0) answerMcq(idx);
  } else if (P.type === 'tf' && q.kind !== 'multi') {
    if ('1dt'.includes(k)) answerSingle(true);
    else if ('2sf'.includes(k)) answerSingle(false);
  }
});

/* ================================================================== */
/* Soạn bộ đề                                                          */
/* ================================================================== */

let ed = null;

function blankQuestion() {
  if (TYPE === 'mcq') return { q: '', options: ['', '', '', ''], answer: null, explain: '' };
  if (TYPE === 'tf') return { kind: 'single', q: '', answer: null, explain: '' };
  return { q: '', answers: [], explain: '' };
}

function isBlank(q) {
  if (q.q.trim() || q.explain.trim()) return false;
  if (TYPE === 'mcq') return q.options.every(o => !o.trim());
  if (TYPE === 'tf') return q.kind === 'multi' ? q.items.every(it => !it.text.trim()) : true;
  return q.answers.length === 0;
}

function closeEditor() {
  const ov = document.getElementById('editor-ov');
  if (ov) ov.remove();
  const im = document.getElementById('import-ov');
  if (im) im.remove();
  ed = null;
}

function openEditor(set, { openImport: wantImport = false } = {}) {
  closeEditor();
  ed = set
    ? { id: set.id, name: set.name, className: set.className || 'Lớp 6', questions: JSON.parse(JSON.stringify(set.questions)) }
    : { id: null, name: '', className: 'Lớp 6', questions: [blankQuestion()] };
  if (!ed.questions.length) ed.questions = [blankQuestion()];

  const classes = ['Lớp 6', 'Lớp 7', 'Lớp 8', 'Lớp 9', 'Lớp 10', 'Lớp 11', 'Lớp 12', 'Khác'];
  if (ed.className && !classes.includes(ed.className)) classes.push(ed.className);

  const panel = h('div', { class: 'bg-white rounded-[1.5rem] md:rounded-[2rem] shadow-2xl border-4 border-pink-100 w-full max-w-3xl flex flex-col', style: 'max-height:96vh;max-height:96dvh' },
    h('div', { class: 'flex items-center justify-between px-4 md:px-6 pt-4 pb-2 border-b-2 border-dashed border-pink-200' },
      h('h2', { class: 'text-lg md:text-xl font-black text-pink-600 uppercase', text: (set ? 'Sửa bộ đề' : 'Soạn bộ đề mới') + ' • ' + META.title }),
      h('button', { class: 'text-gray-400 hover:text-red-500 text-2xl', onclick: () => confirmCloseEditor() }, icon('fa-xmark'))),
    h('div', { class: 'px-4 md:px-6 pt-3 flex flex-col md:flex-row gap-3' },
      h('div', { class: 'flex-1' },
        h('label', { class: 'text-sm font-bold text-gray-700 block mb-1', text: 'Tên bộ đề' }),
        h('input', { id: 'ed-name', type: 'text', class: INPUT, placeholder: 'VD: Bài 10 - Số nguyên tố', value: ed.name, oninput: e => { ed.name = e.target.value; } })),
      h('div', { class: 'md:w-40' },
        h('label', { class: 'text-sm font-bold text-gray-700 block mb-1', text: 'Khối/Lớp' }),
        h('select', { class: INPUT, onchange: e => { ed.className = e.target.value; } },
          classes.map(c => h('option', { value: c, selected: c === ed.className }, c))))),
    h('div', { class: 'px-4 md:px-6 pt-3 flex flex-wrap items-center gap-2' },
      h('button', { class: BTN_BLUE + ' !py-2 text-sm', onclick: () => openImport() }, icon('fa-file-word'), ' Nhập hàng loạt (dán / Word)'),
      h('button', { class: BTN_GHOST, onclick: () => { ed.questions.push(blankQuestion()); renderEditorList(true); } }, icon('fa-plus'), ' Thêm câu'),
      h('span', { id: 'ed-count', class: 'ml-auto text-sm font-bold text-gray-500' })),
    h('div', { class: 'px-4 md:px-6 pt-2 text-xs md:text-sm text-gray-500 font-semibold' },
      'Công thức viết giữa hai dấu $, ví dụ ', h('code', { class: 'bg-gray-100 px-1 rounded', text: '$\\frac{1}{2}$' }), ', ', h('code', { class: 'bg-gray-100 px-1 rounded', text: '$2^3$' }), ', ', h('code', { class: 'bg-gray-100 px-1 rounded', text: '$\\sqrt{9}$' }), '.'),
    h('div', { id: 'ed-list', class: 'flex-1 overflow-y-auto px-4 md:px-6 py-3 flex flex-col gap-3 min-h-[8rem]' }),
    h('div', { class: 'px-4 md:px-6 py-3 border-t-2 border-dashed border-pink-200 flex flex-wrap justify-end gap-2' },
      h('button', { class: BTN_GRAY, onclick: () => confirmCloseEditor() }, 'Hủy'),
      h('button', { class: BTN_GHOST, onclick: () => saveEditor(false) }, icon('fa-floppy-disk'), ' Lưu'),
      h('button', { class: BTN_GREEN, onclick: () => saveEditor(true) }, icon('fa-play'), ' Lưu & Chơi')));

  document.body.append(h('div', { id: 'editor-ov', class: 'fixed inset-0 z-50 bg-pink-900/60 backdrop-blur-sm flex items-center justify-center p-2 md:p-6' }, panel));
  renderEditorList();
  if (wantImport) openImport();
}

function confirmCloseEditor() {
  const touched = ed && (ed.name.trim() || ed.questions.some(q => !isBlank(q)));
  if (touched && !confirm('Đóng cửa sổ soạn đề? Các thay đổi chưa lưu sẽ mất.')) return;
  closeEditor();
}

function field(label, node) {
  return h('div', {}, h('label', { class: 'text-[11px] font-bold text-gray-400 uppercase tracking-wider block mb-1', text: label }), node);
}

function areaInput(value, placeholder, onInput, rows = 2) {
  return h('textarea', { class: INPUT + ' text-sm resize-y', rows: String(rows), placeholder, value, oninput: e => onInput(e.target.value) });
}

function renderEditorList(scrollToEnd) {
  const list = $('#ed-list');
  if (!list) return;
  list.innerHTML = '';
  ed.questions.forEach((q, i) => list.append(questionCard(q, i)));
  const c = $('#ed-count');
  if (c) c.textContent = `${ed.questions.length} câu`;
  if (scrollToEnd) list.scrollTop = list.scrollHeight;
}

function questionCard(q, i) {
  const move = (d) => {
    const j = i + d;
    if (j < 0 || j >= ed.questions.length) return;
    [ed.questions[i], ed.questions[j]] = [ed.questions[j], ed.questions[i]];
    renderEditorList();
  };
  const card = h('div', { class: 'q-card bg-pink-50/40 rounded-2xl border-2 border-pink-100 p-3 md:p-4', 'data-i': String(i) },
    h('div', { class: 'flex items-center justify-between mb-2' },
      h('span', { class: 'font-black text-pink-500', text: `Câu ${i + 1}` }),
      h('div', { class: 'flex gap-1' },
        h('button', { class: 'w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-500 hover:bg-gray-100', title: 'Lên', onclick: () => move(-1) }, icon('fa-arrow-up')),
        h('button', { class: 'w-8 h-8 rounded-lg bg-white border border-gray-200 text-gray-500 hover:bg-gray-100', title: 'Xuống', onclick: () => move(1) }, icon('fa-arrow-down')),
        h('button', {
          class: 'w-8 h-8 rounded-lg bg-red-50 text-red-400 hover:bg-red-400 hover:text-white', title: 'Xóa câu này',
          onclick: () => { ed.questions.splice(i, 1); if (!ed.questions.length) ed.questions.push(blankQuestion()); renderEditorList(); },
        }, icon('fa-trash-can')))));

  const body = h('div', { class: 'flex flex-col gap-2' });
  const isMulti = TYPE === 'tf' && q.kind === 'multi';

  if (TYPE === 'tf') {
    body.append(field('Kiểu câu hỏi', h('select', {
      class: INPUT + ' text-sm md:max-w-xs',
      onchange: e => {
        if (e.target.value === 'multi') {
          q.kind = 'multi';
          q.items = q.items || [0, 1, 2, 3].map(() => ({ text: '', answer: null }));
          delete q.answer;
        } else {
          q.kind = 'single';
          q.answer = null;
          delete q.items;
        }
        renderEditorList();
      },
    },
      h('option', { value: 'single', selected: !isMulti }, 'Một mệnh đề (Đúng/Sai)'),
      h('option', { value: 'multi', selected: isMulti }, 'Có 4 ý a, b, c, d'))));
  }

  body.append(field(isMulti ? 'Câu dẫn' : 'Câu hỏi', areaInput(q.q, 'Nội dung câu hỏi...', v => { q.q = v; })));

  if (TYPE === 'mcq') {
    q.options.forEach((opt, k) => {
      body.append(h('div', { class: 'flex items-center gap-2' },
        h('label', { class: 'flex items-center gap-2 shrink-0 cursor-pointer', title: 'Chọn là đáp án đúng' },
          h('input', { type: 'radio', name: `ans-${i}`, class: 'w-5 h-5 accent-emerald-500', checked: q.answer === k, onchange: () => { q.answer = k; } }),
          h('span', { class: 'font-black text-pink-500 w-5', text: 'ABCD'[k] })),
        h('input', { type: 'text', class: INPUT + ' text-sm', placeholder: `Đáp án ${'ABCD'[k]}`, value: opt, oninput: e => { q.options[k] = e.target.value; } })));
    });
    body.append(h('div', { class: 'text-xs text-gray-400 font-semibold', text: 'Bấm vào nút tròn bên cạnh đáp án đúng.' }));
  } else if (TYPE === 'tf' && !isMulti) {
    body.append(field('Đáp án đúng', h('div', { class: 'flex gap-4 font-bold text-gray-700' },
      [[true, 'Đúng'], [false, 'Sai']].map(([val, label]) => h('label', { class: 'flex items-center gap-2 cursor-pointer' },
        h('input', { type: 'radio', name: `ans-${i}`, class: 'w-5 h-5 accent-emerald-500', checked: q.answer === val, onchange: () => { q.answer = val; } }), label)))));
  } else if (isMulti) {
    q.items.forEach((it, k) => {
      body.append(h('div', { class: 'flex items-center gap-2' },
        h('span', { class: 'font-black text-pink-500 w-5 shrink-0', text: 'abcd'[k] + ')' }),
        h('input', { type: 'text', class: INPUT + ' text-sm', placeholder: `Ý ${'abcd'[k]}`, value: it.text, oninput: e => { it.text = e.target.value; } }),
        h('select', { class: 'border-2 border-pink-200 rounded-xl px-2 py-2 font-bold text-sm bg-white shrink-0', onchange: e => { it.answer = e.target.value === '' ? null : e.target.value === 'T'; } },
          h('option', { value: '', selected: it.answer === null }, '— chọn'),
          h('option', { value: 'T', selected: it.answer === true }, 'Đúng'),
          h('option', { value: 'F', selected: it.answer === false }, 'Sai'))));
    });
  } else {
    body.append(field('Đáp án chấp nhận (nhiều đáp án cách nhau bằng dấu ; )',
      h('input', { type: 'text', class: INPUT + ' text-sm', placeholder: 'VD: 0,5 ; 1/2', value: q.answers.join(' ; '), oninput: e => { q.answers = e.target.value.split(/[;|]/).map(s => s.trim()).filter(Boolean); } })));
  }

  body.append(field('Giải thích (không bắt buộc)', areaInput(q.explain, 'Hiện sau khi công bố đáp án...', v => { q.explain = v; })));
  card.append(body);
  return card;
}

function validateEditor() {
  const bad = [];
  document.querySelectorAll('.q-card').forEach(c => c.classList.remove('!border-rose-400', '!bg-rose-50'));
  ed.questions.forEach((q, i) => {
    if (!isComplete(q, TYPE)) {
      bad.push(i);
      const c = document.querySelector(`.q-card[data-i="${i}"]`);
      if (c) c.classList.add('!border-rose-400', '!bg-rose-50');
    }
  });
  return bad;
}

function saveEditor(thenPlay) {
  const name = ed.name.trim();
  if (!name) { toast('Hãy nhập tên bộ đề.', 'err'); const n = $('#ed-name'); if (n) n.focus(); return; }
  // Bỏ các câu còn trống hoàn toàn
  const filled = ed.questions.filter(q => !isBlank(q));
  if (!filled.length) { toast('Bộ đề chưa có câu hỏi nào.', 'err'); return; }
  ed.questions = filled;
  renderEditorList();
  const bad = validateEditor();
  if (bad.length) {
    const first = document.querySelector(`.q-card[data-i="${bad[0]}"]`);
    if (first) first.scrollIntoView({ block: 'center' });
    if (!confirm(`Có ${bad.length} câu chưa đầy đủ (viền đỏ, ví dụ: chưa chọn đáp án đúng). Các câu này sẽ không chơi được. Vẫn lưu?`)) return;
  }
  const set = sanitizeSet({
    id: ed.id !== null ? ed.id : Date.now(), type: TYPE, name, className: ed.className, questions: ed.questions, updatedAt: Date.now(),
  });
  upsertSet(set);
  closeEditor();
  if (thenPlay) {
    if (!set.questions.some(q => isComplete(q, TYPE))) { toast('Đã lưu, nhưng chưa có câu nào đầy đủ để chơi.', 'err'); renderHome(); return; }
    renderSetup(set);
  } else {
    renderHome();
  }
  toast('Đã lưu bộ đề.');
}

/* ================================================================== */
/* Nhập hàng loạt từ văn bản / Word                                     */
/* ================================================================== */

let mammothPromise = null;
function loadMammoth() {
  if (window.mammoth) return Promise.resolve();
  if (!mammothPromise) {
    mammothPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js';
      s.onload = resolve;
      s.onerror = () => { mammothPromise = null; reject(new Error('không tải được bộ đọc file Word (cần có mạng)')); };
      document.head.append(s);
    });
  }
  return mammothPromise;
}

/**
 * Chuyển HTML từ file Word thành các dòng văn bản.
 * - Đáp án in đậm/gạch chân được đánh dấu bằng dấu * ở đầu dòng.
 * - Danh sách tự đánh số của Word (mất số/chữ khi đọc) được gắn lại nhãn: "Câu n." cho danh sách câu hỏi, "A." "B."... cho các đáp án.
 */
function htmlToText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  const LABELED = /^(?:Câu|Cau|Bài|Question)\s*\d+|^[A-Da-d]\s*[.)]|^\d+\s*[.)]\s/i;

  const lineOf = (el, label) => {
    const c = el.cloneNode(true);
    c.querySelectorAll('ol, ul').forEach(n => n.remove());
    c.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
    let raw = c.textContent.replace(/ /g, ' ').trim();
    if (!raw) return null;
    const isOption = !!label && /^[A-F]\./.test(label) || /^[A-Da-d]\s*[.)]/.test(raw);
    // Nhiều đáp án trên cùng một dòng ("A. 4   B. 5   C. 6   D. 7"): đáp án in đậm/gạch chân được đánh dấu * ngay trước nhãn của nó.
    const countLabels = t => (t.match(/(?:^|\s)[A-Da-d]\s*[.)]\s/g) || []).length;
    const multiInline = isOption && countLabels(raw) >= 2;
    if (multiInline) {
      let marked = false;
      c.querySelectorAll('strong, b, u').forEach(e => {
        if (!c.contains(e)) return;
        const t = e.textContent;
        if (!t.trim() || countLabels(t) >= 2) return; // cả dòng cùng in đậm thì không phân biệt được đáp án nào
        if (/^\s*[A-Da-d]\s*[.)]/.test(t)) { e.replaceWith('*' + t); marked = true; return; }
        const prev = e.previousSibling;
        if (prev && prev.nodeType === 3 && /[A-Da-d]\s*[.)]\s*$/.test(prev.nodeValue)) {
          prev.nodeValue = prev.nodeValue.replace(/([A-Da-d]\s*[.)]\s*)$/, '*$1');
          marked = true;
        }
      });
      if (marked) raw = c.textContent.replace(/ /g, ' ').trim();
    }
    let star = false;
    if (isOption && !multiInline) {
      const emphLen = [...c.querySelectorAll('strong, b, u')].reduce((n, e) => n + e.textContent.trim().length, 0);
      const first = c.firstElementChild;
      const labelEmph = first && /^(STRONG|B|U)$/.test(first.tagName) && /^[A-Da-d]\s*[.)]?$/.test(first.textContent.trim());
      star = !!labelEmph || (emphLen > 0 && emphLen >= raw.length * 0.6);
    }
    const text = label && !LABELED.test(raw) ? `${label} ${raw}` : raw;
    return (star ? '*' : '') + text;
  };

  const list = (el, depth) => {
    const items = [...el.children].filter(c => c.tagName === 'LI');
    const nested = items.some(li => li.querySelector(':scope > ol, :scope > ul'));
    let mode = 'none';
    if (el.tagName === 'OL') {
      if (depth > 0) mode = 'letters';
      else if (nested || items.length >= 7) mode = 'cau';
      else {
        const prev = el.previousElementSibling;
        const pt = prev ? prev.textContent.trim() : '';
        mode = prev && prev.tagName === 'P' && (/^(Câu|Cau|Bài)\s*\d+/i.test(pt) || /[:?]\s*$/.test(pt)) ? 'letters' : 'cau';
      }
    }
    items.forEach((li, i) => {
      const label = mode === 'letters' ? `${'ABCDEFGH'[i] || '?'}.` : mode === 'cau' ? `Câu ${i + 1}.` : null;
      const l = lineOf(li, label);
      if (l) out.push(l);
      li.querySelectorAll(':scope > ol, :scope > ul').forEach(sub => list(sub, depth + 1));
    });
  };

  const walk = parent => {
    for (const el of parent.children) {
      const tag = el.tagName;
      if (tag === 'OL' || tag === 'UL') list(el, 0);
      else if (/^(P|H[1-6])$/.test(tag)) { const l = lineOf(el, null); if (l) out.push(l); }
      else if (tag === 'TABLE') {
        el.querySelectorAll('tr').forEach(tr => {
          const cells = [...tr.children].map(td => td.textContent.replace(/\s+/g, ' ').trim());
          if (cells.some(Boolean)) out.push(cells.join(' | '));
        });
      } else walk(el);
    }
  };
  walk(doc.body);
  return out.join('\n');
}

async function readFileToText(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.docx')) {
    await loadMammoth();
    const buf = await file.arrayBuffer();
    const res = await window.mammoth.convertToHtml({ arrayBuffer: buf }, { styleMap: ['u => u'] });
    return htmlToText(res.value);
  }
  if (name.endsWith('.doc')) throw new Error('chưa đọc được định dạng .doc cũ, hãy lưu lại thành .docx');
  return file.text();
}

const IMPORT_HELP = {
  mcq: 'Mỗi đáp án A, B, C, D một dòng (hoặc cùng một dòng). Đáp án đúng: thêm dòng "Đáp án: B", hoặc gắn dấu * trước đáp án đúng. Trong file Word, đáp án đúng được in đậm hoặc gạch chân cũng được nhận. Có thể gom đáp án ở cuối đề: dòng "ĐÁP ÁN" rồi "1-B 2-C 3-A...".',
  tf: 'Câu một mệnh đề: thêm dòng "Đáp án: Đúng" (hoặc Sai), hoặc ghi (Đ)/(S) cuối câu. Câu 4 ý: ghi các ý a), b), c), d) rồi dòng "Đáp án: Đ S Đ Đ", hoặc ghi (Đ)/(S) cuối từng ý, hoặc gắn * trước ý đúng.',
  short: 'Thêm dòng "Đáp án: ..." sau mỗi câu. Nhiều đáp án chấp nhận thì cách nhau bằng dấu ; ví dụ "Đáp án: 0,5 ; 1/2".',
}[TYPE];

function openImport() {
  const existing = document.getElementById('import-ov');
  if (existing) existing.remove();
  let parsed = null;

  const ta = h('textarea', {
    class: 'w-full h-44 md:h-56 border-2 border-indigo-200 rounded-xl p-3 font-mono text-sm focus:outline-none focus:border-indigo-500',
    placeholder: 'Dán nội dung câu hỏi vào đây, hoặc bấm "Chọn file Word / .txt"...',
  });
  const result = h('div', { class: 'mt-3 text-sm max-h-48 overflow-y-auto' });
  const addBtn = h('button', { class: BTN_GREEN, disabled: true }, icon('fa-plus'), ' Thêm vào bộ đề');

  const preview = () => {
    parsed = parseBulk(ta.value, TYPE);
    result.innerHTML = '';
    const ok = parsed.questions.length;
    result.append(h('div', { class: `font-black ${ok ? 'text-emerald-600' : 'text-rose-600'}`, text: ok ? `Đọc được ${ok} câu hợp lệ.` : 'Chưa đọc được câu nào.' }));
    if (parsed.warnings.length) {
      result.append(h('div', { class: 'mt-2 bg-amber-50 border border-amber-300 rounded-xl p-2 text-amber-800 font-semibold' },
        parsed.warnings.map(w => h('div', { text: '⚠ ' + w }))));
    }
    if (ok) {
      result.append(h('ol', { class: 'mt-2 list-decimal pl-5 text-gray-700 font-semibold flex flex-col gap-1' },
        parsed.questions.slice(0, 30).map(q => h('li', { text: q.q.replace(/\s+/g, ' ').slice(0, 90) + (q.q.length > 90 ? '…' : '') })),
        ok > 30 ? h('li', { class: 'list-none text-gray-400', text: `… và ${ok - 30} câu nữa` }) : null));
    }
    addBtn.disabled = !ok;
    addBtn.replaceChildren(icon('fa-plus'), ` Thêm ${ok} câu vào bộ đề`);
  };

  addBtn.addEventListener('click', () => {
    if (!parsed || !parsed.questions.length || !ed) return;
    ed.questions = ed.questions.filter(q => !isBlank(q)).concat(parsed.questions);
    renderEditorList(true);
    document.getElementById('import-ov').remove();
    toast(`Đã thêm ${parsed.questions.length} câu vào bộ đề.`);
  });

  const fileIn = h('input', {
    type: 'file', accept: '.docx,.txt,.md,text/plain', class: 'hidden',
    onchange: async e => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      result.textContent = 'Đang đọc file...';
      try { ta.value = await readFileToText(f); preview(); }
      catch (err) { result.innerHTML = ''; result.append(h('div', { class: 'text-rose-600 font-bold', text: 'Không đọc được file: ' + err.message })); }
    },
  });

  const panel = h('div', { class: 'bg-white rounded-[1.5rem] shadow-2xl border-4 border-indigo-100 w-full max-w-2xl flex flex-col p-4 md:p-6', style: 'max-height:94vh;max-height:94dvh;overflow-y:auto' },
    h('div', { class: 'flex items-center justify-between mb-2' },
      h('h3', { class: 'text-lg font-black text-indigo-600 uppercase', text: 'Nhập hàng loạt câu hỏi' }),
      h('button', { class: 'text-gray-400 hover:text-red-500 text-2xl', onclick: () => document.getElementById('import-ov').remove() }, icon('fa-xmark'))),
    h('details', { class: 'mb-3 bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-sm text-indigo-900 font-semibold' },
      h('summary', { class: 'cursor-pointer font-black', text: 'Cách viết đề (bấm để xem)' }),
      h('div', { class: 'mt-2 flex flex-col gap-2' },
        h('div', { text: 'Mỗi câu bắt đầu bằng "Câu 1.", "Câu 2."... Có thể thêm dòng "Giải thích: ...".' }),
        h('div', { text: IMPORT_HELP }),
        h('div', { text: 'File Word: danh sách tự đánh số "Câu", "A, B, C, D" sẽ được gắn lại nhãn tự động, hãy xem phần xem trước để chắc chắn đúng. Công thức soạn bằng Equation của Word không đọc được, hãy viết dạng $...$.' }),
        h('button', { class: BTN_GHOST + ' self-start text-sm', onclick: () => { ta.value = BULK_TEMPLATES[TYPE]; preview(); } }, icon('fa-clipboard'), ' Chép mẫu vào ô bên dưới'))),
    h('div', { class: 'flex flex-wrap gap-2 mb-2' },
      h('button', { class: BTN_BLUE + ' !py-2 text-sm', onclick: () => fileIn.click() }, icon('fa-upload'), ' Chọn file Word / .txt'),
      fileIn),
    ta,
    h('div', { class: 'flex flex-wrap gap-2 mt-3' },
      h('button', { class: BTN_GHOST, onclick: preview }, icon('fa-eye'), ' Xem trước'), addBtn),
    result);

  document.body.append(h('div', { id: 'import-ov', class: 'fixed inset-0 z-[60] bg-indigo-900/60 backdrop-blur-sm flex items-center justify-center p-2 md:p-6' }, panel));
}

/* ================================================================== */
/* Khởi động                                                           */
/* ================================================================== */

if (!META) {
  document.body.textContent = 'Thiếu cấu hình trò chơi (GAME_TYPE).';
} else {
  buildShell();
  renderHome();
}
