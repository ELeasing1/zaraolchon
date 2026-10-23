import { render, usedFiles } from './render.js';

const ROOT = new URL('../', location.href).href;
const API = 'https://api.github.com';
const LS_OLD_AUTH = 'zarya.admin.auth', LS_DRAFT = 'zarya.admin.draft', LS_DEV = 'zarya.admin.device';

/* ───────── утилиты ───────── */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false || kid === '') continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const clone = o => JSON.parse(JSON.stringify(o));
const plain = s => String(s || '').replace(/\*+/g, '').replace(/\s+/g, ' ').trim();
const cut = (s, n = 50) => { s = plain(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const fmtDate = d => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const mimeOf = p => /\.png$/i.test(p) ? 'image/png' : /\.jpe?g$/i.test(p) ? 'image/jpeg' : 'image/webp';
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya' };
const slug = s => String(s || '').toLowerCase().split('').map(ch => TR[ch] ?? ch).join('').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-/, '');

let toastT;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg; t.className = 'toast' + (bad ? ' bad' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, bad ? 7000 : 3200);
}
function dialog(title, body, buttons = [{ label: 'Понятно', value: true, cls: 'btn--primary' }]) {
  return new Promise(resolve => {
    const m = $('#modal'), card = $('#modalCard');
    const done = v => { m.hidden = true; resolve(v); };
    const nodes = (Array.isArray(body) ? body : [body]).map(b => typeof b === 'string' ? h('p', { text: b }) : b);
    card.replaceChildren(h('h2', { text: title }), ...nodes,
      h('div', { class: 'acts' }, buttons.map(b => h('button', { type: 'button', class: 'btn ' + (b.cls || ''), onclick: () => done(b.value) }, b.label))));
    m.hidden = false;
    m.onclick = e => { if (e.target === m) done(null); };
  });
}
const confirmDo = (title, text, label) => dialog(title, text, [{ label: 'Отмена', value: false }, { label, value: true, cls: 'btn--primary' }]);

/* Хранилище в IndexedDB: фото, ещё не опубликованные (переживают перезагрузку страницы),
   и «запомненный» ключ входа — отдельной базой, чтобы очистка фото его не задевала */
const makeStore = name => {
  let p;
  const open = () => p ||= new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('files', mode), req = fn(t.objectStore('files'));
      t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error);
    });
  };
  return {
    put: (k, v) => run('readwrite', s => s.put(v, k)).catch(() => {}),
    get: k => run('readonly', s => s.get(k)).catch(() => null),
    clear: () => run('readwrite', s => s.clear()).catch(() => {}),
  };
};
const idb = makeStore('zarya-admin'), keyStore = makeStore('zarya-admin-key');

/* ───────── состояние ───────── */
const S = {
  auth: null,            // { repo, branch, token } — только в памяти страницы
  vault: null,           // зашифрованный ключ из admin/vault.json
  hint: null,            // репозиторий и ветка после выхода — для подсказки на экране входа
  mode: null,            // 'github' | 'demo'
  content: null,         // редактируемая копия content.json
  baseJson: '',          // опубликованная версия (для «есть изменения»)
  baseSha: null,         // sha файла content.json на момент загрузки
  headSha: null,         // sha последнего коммита на момент загрузки
  pending: new Map(),    // путь → { blob, url } — новые фото
  restore: new Map(),    // путь → sha блоба — фото из старой версии, которых нет на сайте
  restoreUrls: new Map(),
  sel: 'hero',
  open: new WeakSet(),   // раскрытые карточки
  undo: [], redo: [],
  siteContent: null,
};
const isDirty = () => !!S.content && (JSON.stringify(S.content) !== S.baseJson);
const thumbUrl = p => !p ? '' : S.pending.get(p)?.url || S.restoreUrls.get(p) || ROOT + p;
const previewAsset = p => S.pending.get(p)?.url || S.restoreUrls.get(p) || p;

function normalize(c) {
  c.admin ||= { repo: '', branch: 'main' }; c.build ||= {}; c.meta ||= {}; c.colors ||= {}; c.brand ||= {};
  c.contacts ||= {}; c.contacts.labels ||= {}; c.nav ||= []; c.hero ||= {}; c.sections ||= []; c.footer ||= {};
  c.ui ||= {}; c.schema ||= {}; c.schema.amenities ||= []; c.schema.offers ||= []; c.dims ||= {};
  c.sections.forEach(s => { s.blocks ||= []; });
  return c;
}

/* ───────── GitHub ───────── */
function ghMessage(status, msg) {
  if (status === 401) return 'GitHub не принял токен: он неверный или его срок истёк. Выпустите новый токен и войдите заново.';
  if (status === 403) return 'У токена не хватает прав. Нужен доступ «Contents: Read and write» к репозиторию сайта.' + (msg ? ` (${msg})` : '');
  if (status === 404) return 'Не нашёл репозиторий, ветку или файл content.json. Проверьте название репозитория (имя-аккаунта/название) и ветку.';
  if (status === 409 || status === 422) return 'GitHub отклонил изменение: ' + msg;
  return `Ошибка GitHub (${status})${msg ? ': ' + msg : ''}`;
}
async function gh(path, opt = {}) {
  let r;
  try {
    r = await fetch(API + path, {
      ...opt, cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + S.auth.token, 'X-GitHub-Api-Version': '2022-11-28', ...(opt.body ? { 'Content-Type': 'application/json' } : {}) },
    });
  } catch { throw new Error('Нет связи с GitHub. Проверьте интернет и попробуйте ещё раз.'); }
  if (!r.ok) {
    let msg = ''; try { msg = (await r.json()).message; } catch {}
    const e = new Error(ghMessage(r.status, msg)); e.status = r.status; throw e;
  }
  return r.status === 204 ? null : r.json();
}
const rp = (p = '') => `/repos/${S.auth.repo}${p}`;

/* ───────── ключ GitHub под паролем ─────────
   В репозитории (admin/vault.json) ключ лежит только зашифрованным: AES-256-GCM, а ключ шифрования
   получается из пароля через PBKDF2-SHA256 (1 млн шагов — каждая попытка подбора занимает заметное время).
   Без пароля ключ не достать, поэтому пароль должен быть длинным. */
const KDF_ITER = 1000000;
const te = new TextEncoder(), td = new TextDecoder();
const toB64 = buf => { let t = ''; new Uint8Array(buf).forEach(c => { t += String.fromCharCode(c); }); return btoa(t); };
const fromB64 = t => Uint8Array.from(atob(t), c => c.charCodeAt(0));
async function deriveKey(password, salt, iter) {
  const base = await crypto.subtle.importKey('raw', te.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function sealVault(auth, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, KDF_ITER);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(auth)));
  return { vault: { v: 1, kdf: 'PBKDF2-SHA256', iter: KDF_ITER, salt: toB64(salt), iv: toB64(iv), data: toB64(data) }, key };
}
async function openVault(vault, key) {
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(vault.iv) }, key, fromB64(vault.data));
  const a = JSON.parse(td.decode(raw));
  if (!a?.repo || !a?.token) throw new Error('bad vault');
  return a;
}
const vaultKey = (vault, password) => deriveKey(password, fromB64(vault.salt), vault.iter);
async function fetchVault() {
  try {
    const r = await fetch(new URL('vault.json', location.href).href + '?v=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.v === 1 && j.salt && j.iv && j.data && j.iter >= 100000 ? j : null;
  } catch { return null; }
}
function weakPassword(pw) {
  if (pw.length < 12) return 'Пароль слишком короткий: нужно хотя бы 12 знаков. Проще всего нажать «Придумать надёжный пароль».';
  if (/^(.)\1*$/.test(pw) || /^\d+$/.test(pw)) return 'Слишком простой пароль.';
  if (/заря|zarya|zarja|ольхон|olhon|olkhon|хужир|khuzhir|байкал|baikal|пароль|password|qwerty|12345|йцукен/i.test(pw)) return 'В пароле не должно быть названия сайта и простых слов — такие пароли подбирают первыми.';
  const classes = [/[a-zа-яё]/, /[A-ZА-ЯЁ]/, /\d/, /[^a-zA-Zа-яА-ЯёЁ\d]/].filter(r => r.test(pw)).length;
  if (pw.length < 16 && classes < 3) return 'Добавьте заглавные буквы, цифры или знаки — или сделайте пароль длиннее 16 знаков.';
  return '';
}
function genPassword() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';  // 31 знак без похожих (нет 0/o, 1/l/i)
  for (;;) {
    const out = [];
    while (out.length < 16) for (const v of crypto.getRandomValues(new Uint8Array(32))) if (v < 248 && out.length < 16) out.push(A[v % 31]);
    const pw = out.join('').replace(/(.{4})(?=.)/g, '$1-');
    if (!weakPassword(pw)) return pw;
  }
}
// Один коммит с набором файлов в ветку сайта
async function commitFiles(entries, message) {
  const head = await headSha();
  const base = (await gh(rp(`/git/commits/${head}`))).tree.sha;
  const nt = await gh(rp('/git/trees'), { method: 'POST', body: JSON.stringify({ base_tree: base, tree: entries }) });
  const nc = await gh(rp('/git/commits'), { method: 'POST', body: JSON.stringify({ message, tree: nt.sha, parents: [head] }) });
  await gh(rp(`/git/refs/heads/${S.auth.branch}`), { method: 'PATCH', body: JSON.stringify({ sha: nc.sha }) });
  return nc.sha;
}
async function saveVault(vault, message) {
  S.headSha = await commitFiles([{ path: 'admin/vault.json', mode: '100644', type: 'blob', content: JSON.stringify(vault, null, 2) + '\n' }], message);
  S.vault = vault;
}
const b64ToBytes = b64 => Uint8Array.from(atob(b64.replace(/\s/g, '')), ch => ch.charCodeAt(0));
const b64ToText = b64 => new TextDecoder().decode(b64ToBytes(b64));
const blobToB64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
async function loadRemote(ref) {
  const f = await gh(rp(`/contents/content.json?ref=${encodeURIComponent(ref || S.auth.branch)}`));
  return { json: b64ToText(f.content), sha: f.sha };
}
const headSha = async () => (await gh(rp(`/git/ref/heads/${S.auth.branch}`))).object.sha;
async function treeFiles(commitSha) {
  const commit = await gh(rp(`/git/commits/${commitSha}`));
  const t = await gh(rp(`/git/trees/${commit.tree.sha}?recursive=1`));
  return { treeSha: commit.tree.sha, files: new Map(t.tree.filter(e => e.type === 'blob').map(e => [e.path, e.sha])), truncated: t.truncated };
}

/* ───────── фото ───────── */
const KINDS = {
  photo: { max: 1600, q: 0.82 },
  logo: { max: 400, maxW: 324, alpha: true, q: 0.9 },
  emblem: { max: 640, alpha: true, q: 0.88 },
  og: { crop: [1200, 630], q: 0.85, jpeg: true },
};
async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  const url = URL.createObjectURL(file);
  try { const im = new Image(); im.src = url; await im.decode(); return im; }
  catch {
    throw new Error(/hei[cf]/i.test(file.type + file.name)
      ? 'Фото в формате HEIC браузер не открывает. Сохраните его как JPG (на iPhone: Настройки → Камера → Форматы → «Наиболее совместимый») и загрузите снова.'
      : `Не получилось открыть «${file.name}» как изображение.`);
  } finally { URL.revokeObjectURL(url); }
}
const canvas = (w, hh) => Object.assign(document.createElement('canvas'), { width: w, height: hh });
const toBlob = (cv, type, q) => new Promise(res => cv.toBlob(res, type, q));
// Уменьшение в несколько шагов — так фото остаются чёткими
function resize(src, w, hh, alpha) {
  let cur = src, cw = src.width, ch = src.height;
  while (cw / 2 >= w && ch / 2 >= hh) {
    const t = canvas(Math.round(cw / 2), Math.round(ch / 2)), x = t.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, t.width, t.height);
    cur = t; cw = t.width; ch = t.height;
  }
  const cv = canvas(w, hh), x = cv.getContext('2d');
  if (!alpha) { x.fillStyle = '#fff'; x.fillRect(0, 0, w, hh); }
  x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, w, hh);
  return cv;
}
async function encode(cv, K) {
  if (!K.jpeg) {
    const b = await toBlob(cv, 'image/webp', K.q);
    if (b && b.type === 'image/webp') return { blob: b, ext: 'webp' };
  }
  if (K.alpha) return { blob: await toBlob(cv, 'image/png'), ext: 'png' };
  return { blob: await toBlob(cv, 'image/jpeg', K.q), ext: 'jpg' };
}
async function processImage(file, kind = 'photo') {
  const K = KINDS[kind] || KINDS.photo;
  const src = await decode(file);
  let cv;
  if (K.crop) {
    const [tw, th] = K.crop, k = Math.max(tw / src.width, th / src.height);
    const big = resize(src, Math.round(src.width * k), Math.round(src.height * k), false);
    cv = canvas(tw, th);
    cv.getContext('2d').drawImage(big, (big.width - tw) / 2, (big.height - th) / 2, tw, th, 0, 0, tw, th);
  } else {
    const k = Math.min(1, K.max / Math.max(src.width, src.height), (K.maxW || 1e9) / src.width);
    cv = resize(src, Math.max(1, Math.round(src.width * k)), Math.max(1, Math.round(src.height * k)), K.alpha);
  }
  src.close?.();
  const { blob, ext } = await encode(cv, K);
  return { blob, ext, w: cv.width, h: cv.height };
}
async function makeIcons(file) {
  const src = await decode(file);
  const draw = (size, bg, pad) => {
    const s = Math.min((size - 2 * pad) / src.width, (size - 2 * pad) / src.height);
    const w = Math.round(src.width * s), hh = Math.round(src.height * s);
    const img = resize(src, w, hh, true), cv = canvas(size, size), x = cv.getContext('2d');
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, size, size); }
    x.drawImage(img, Math.round((size - w) / 2), Math.round((size - hh) / 2));
    return cv;
  };
  const ico = await toBlob(draw(64, null, 0), 'image/png');
  const touch = await toBlob(draw(180, S.content.colors.paper || '#F5F1E8', 14), 'image/png');
  src.close?.();
  return { ico, touch };
}
const newPath = (name, ext) => `img/${slug(name).replace(/-$/, '') || 'foto'}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}.${ext}`;
function addPending(path, blob, w, hh) {
  S.pending.set(path, { blob, url: URL.createObjectURL(blob) });
  S.content.dims[path] = [w, hh];
  idb.put(path, blob);
}
async function uploadPhoto(file, kind, name) {
  const r = await processImage(file, kind);
  const p = newPath(name, r.ext);
  addPending(p, r.blob, r.w, r.h);
  return p;
}

/* ───────── изменения, отмена, черновик ───────── */
let lastSnap = 0;
function beforeChange() {
  const now = Date.now();
  if (now - lastSnap > 1200) {
    S.undo.push(JSON.stringify(S.content));
    if (S.undo.length > 100) S.undo.shift();
    S.redo = [];
  }
  lastSnap = now;
}
function changed(structural) {
  if (structural) renderEditor();
  renderSide();
  updateStatus();
  schedulePreview();
  saveDraft();
}
function undo() {
  if (!S.undo.length) return;
  S.redo.push(JSON.stringify(S.content)); S.content = JSON.parse(S.undo.pop()); lastSnap = 0;
  fixSel(); changed(true);
}
function redo() {
  if (!S.redo.length) return;
  S.undo.push(JSON.stringify(S.content)); S.content = JSON.parse(S.redo.pop()); lastSnap = 0;
  fixSel(); changed(true);
}
function fixSel() {
  const m = /^s:(\d+)$/.exec(S.sel);
  if (m && +m[1] >= S.content.sections.length) S.sel = 'hero';
}
let draftT;
function saveDraft() {
  clearTimeout(draftT);
  draftT = setTimeout(() => {
    try {
      if (isDirty()) localStorage.setItem(LS_DRAFT, JSON.stringify({ content: S.content, baseSha: S.baseSha, mode: S.mode, repo: S.auth?.repo || '', at: Date.now(), restore: [...S.restore] }));
      else localStorage.removeItem(LS_DRAFT);
    } catch { /* переполнено хранилище — черновик не сохранится, но работе это не мешает */ }
  }, 400);
}
async function loadRestoreUrls() {
  for (const [p, sha] of S.restore) {
    if (S.restoreUrls.has(p)) continue;
    try {
      const b = await gh(rp(`/git/blobs/${sha}`));
      S.restoreUrls.set(p, URL.createObjectURL(new Blob([b64ToBytes(b.content)], { type: mimeOf(p) })));
    } catch {}
  }
}
async function maybeRestoreDraft() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(LS_DRAFT) || 'null'); } catch {}
  if (!d?.content || d.mode !== S.mode || (S.mode === 'github' && d.repo !== S.auth.repo)) return;
  if (JSON.stringify(d.content) === S.baseJson) return;
  const fresh = S.mode !== 'github' || d.baseSha === S.baseSha;
  const ok = await dialog('Есть неопубликованный черновик', [
    `Вы вносили изменения ${fmtDate(d.at)}, но не опубликовали их.`,
    fresh ? '' : h('p', { class: 'note warn', text: 'С тех пор сайт уже обновлялся. Если продолжить с черновика, при публикации он заменит более свежие правки.' }),
  ], [{ label: 'Удалить черновик', value: false }, { label: 'Продолжить с черновика', value: true, cls: 'btn--primary' }]);
  if (!ok) { localStorage.removeItem(LS_DRAFT); idb.clear(); return; }
  S.content = normalize(d.content);
  S.restore = new Map(d.restore || []);
  for (const p of usedFiles(S.content)) {
    if (S.pending.has(p)) continue;
    const blob = await idb.get(p);
    if (blob) S.pending.set(p, { blob, url: URL.createObjectURL(blob) });
  }
  if (S.mode === 'github') await loadRestoreUrls();
}

/* ───────── описание полей ───────── */
const F = {
  text: (k, label, o) => ({ t: 'text', k, label, ...o }),
  area: (k, label, o) => ({ t: 'area', k, label, ...o }),
  img: (k, label, o) => ({ t: 'img', k, label, ...o }),
  sel: (k, label, opts, o) => ({ t: 'sel', k, label, opts, ...o }),
  bool: (k, label, o) => ({ t: 'bool', k, label, ...o }),
  color: (k, label, o) => ({ t: 'color', k, label, ...o }),
  list: (k, label, fields, o) => ({ t: 'list', k, label, fields, ...o }),
  strs: (k, label, o) => ({ t: 'strs', k, label, ...o }),
  group: (k, label, fields, o) => ({ t: 'group', k, label, fields, ...o }),
  note: (text, o) => ({ t: 'note', text, ...o }),
  row: (...fields) => ({ t: 'row', fields }),
};
const RATIOS = [['43', '4:3 — горизонтальное'], ['32', '3:2 — горизонтальное, шире'], ['169', '16:9 — панорама'], ['54', '5:4 — почти квадрат'], ['11', '1:1 — квадрат'], ['45', '4:5 — вертикальное'], ['34', '3:4 — вертикальное, выше']];
const SIZES = [['4', '1/3 ширины'], ['5', 'чуть меньше половины'], ['6', 'половина'], ['7', 'чуть больше половины'], ['8', '2/3 ширины'], ['12', 'вся ширина']];
const SPACES = [['', 'Стандартный'], ['0', 'Нет'], ['s', 'Маленький'], ['m', 'Средний'], ['l', 'Большой']];
const ALT_HINT = 'Коротко: что на фото. Это читают поисковики и незрячие посетители.';
const BTN = [
  F.text('label', 'Текст на кнопке'),
  F.row(
    F.sel('link', 'Что делает', [['call', 'Звонок на телефон'], ['ask', 'Открывает Telegram'], ['url', 'Открывает ссылку']], { rerender: true }),
    F.sel('style', 'Вид', [['dark', 'Тёмная'], ['line', 'Светлая с рамкой']])),
  F.text('url', 'Ссылка', { show: b => b.link === 'url', ph: 'https://…' }),
];
const btnList = (k, label) => F.list(k, label, BTN, { title: b => b.label, item: () => ({ label: 'Кнопка', link: 'url', url: '', style: 'line' }), addLabel: 'Добавить кнопку' });
function mosaicInfo(arr) {
  if (!arr.length) return null;
  const rows = []; let cur = [], sum = 0;
  for (const p of arr) { const s = +p.size || 4; if (sum + s > 12) { rows.push(cur); cur = []; sum = 0; } cur.push(s); sum += s; }
  rows.push(cur);
  const bad = rows.some(r => r.reduce((a, b) => a + b, 0) !== 12);
  return { bad, text: `Ряды на компьютере: ${rows.map(r => r.join('+')).join(' · ')} (из 12)` + (bad ? ' — неполный ряд оставит пустое место справа.' : ' ✓') + ' На телефоне фото листаются вбок.' };
}

const BLOCKS = {
  duo: {
    name: 'Фото и текст', desc: 'Фото слева или справа, рядом заголовок, текст, цены, шаги или кнопки',
    make: () => ({ image: '', alt: '', ratio: '43', side: 'left', wide: 'photo', label: '', h3: 'Заголовок', big: '', lead: '', text: 'Текст блока', accent: '', prices: [], steps: [], buttons: [] }),
    sum: b => b.h3 || b.big || b.label || b.lead || b.text,
    fields: [
      F.img('image', 'Фото', { alt: 'alt', optional: true }),
      F.row(F.sel('side', 'Где фото', [['left', 'Слева'], ['right', 'Справа']]), F.sel('wide', 'Какая колонка шире', [['photo', 'Фото'], ['text', 'Текст']])),
      F.sel('ratio', 'Форма фото', RATIOS),
      F.text('label', 'Надзаголовок (мелкими буквами)'),
      F.area('h3', 'Заголовок'),
      F.area('big', 'Крупная фраза'),
      F.area('lead', 'Вводный абзац (крупнее обычного)'),
      F.area('text', 'Основной текст', { rows: 5 }),
      F.area('accent', 'Выделенный абзац (темнее)'),
      F.list('prices', 'Мини-прайс', [F.text('title', 'Название'), F.text('sub', 'Подпись'), F.text('price', 'Цена')], { compact: true, item: () => ({ title: '', sub: '', price: '' }), addLabel: 'Добавить строку' }),
      F.list('steps', 'Нумерованные шаги', [F.text('title', 'Заголовок шага'), F.area('text', 'Текст шага')], { compact: true, item: () => ({ title: '', text: '' }), addLabel: 'Добавить шаг' }),
      btnList('buttons', 'Кнопки'),
    ],
  },
  photo: {
    name: 'Фото во всю ширину', desc: 'Широкий кадр от края до края',
    make: () => ({ image: '', alt: '' }), sum: b => b.alt,
    fields: [F.img('image', 'Фото', { alt: 'alt' })],
  },
  text: {
    name: 'Текст', desc: 'Абзацы текста, можно с крупной фразой сверху',
    make: () => ({ big: '', text: 'Текст' }), sum: b => b.big || b.text,
    fields: [F.area('big', 'Крупная фраза (необязательно)'), F.area('text', 'Текст', { rows: 6 })],
  },
  split: {
    name: 'Заголовок и текст в две колонки', desc: 'Слева заголовок, справа абзацы — как у «Семейного номера»',
    make: () => ({ label: '', h3: 'Заголовок', text: 'Текст' }), sum: b => b.h3 || b.label,
    fields: [F.text('label', 'Надзаголовок (мелкими буквами)'), F.area('h3', 'Заголовок'), F.area('text', 'Текст справа', { rows: 5 })],
  },
  mosaic: {
    name: 'Фотогалерея', desc: 'Несколько фото плиткой; на телефоне листаются вбок',
    make: () => ({ photos: [] }), sum: b => `${(b.photos || []).length} фото`,
    fields: [F.list('photos', 'Фото', [F.img('image', 'Фото', { alt: 'alt' }), F.row(F.sel('size', 'Ширина на компьютере', SIZES), F.sel('ratio', 'Форма', RATIOS))],
      { multi: true, thumb: 'image', title: p => p.alt || 'Фото', item: () => ({ image: '', alt: '', size: '4', ratio: '43' }), info: mosaicInfo, addLabel: 'Добавить фото' })],
  },
  cards: {
    name: 'Фото с подписями', desc: 'Карточки: фото, заголовок и короткий текст',
    make: () => ({ items: [] }), sum: b => (b.items || []).map(i => i.title).join(', '),
    fields: [F.list('items', 'Карточки', [F.img('image', 'Фото', { alt: 'alt' }), F.text('title', 'Заголовок'), F.text('text', 'Короткий текст')],
      { multi: true, thumb: 'image', title: i => i.title, item: () => ({ image: '', alt: '', title: '', text: '' }), addLabel: 'Добавить карточку' })],
  },
  features: {
    name: 'Список удобств', desc: 'Пункты в три колонки: название и пояснение',
    make: () => ({ label: '', items: [{ title: '', sub: '' }] }), sum: b => b.label || (b.items || []).map(i => i.title).join(', '),
    fields: [F.text('label', 'Заголовок над списком (необязательно)'),
      F.list('items', 'Пункты', [F.text('title', 'Название'), F.text('sub', 'Пояснение')], { compact: true, item: () => ({ title: '', sub: '' }), addLabel: 'Добавить пункт' })],
  },
  prices: {
    name: 'Цены', desc: 'Таблица: название, описание и цена',
    make: () => ({ rows: [{ title: '', sub: '', text: '', price: '', note: '' }], note: '' }), sum: b => (b.rows || []).map(r => r.title).join(', '),
    fields: [
      F.list('rows', 'Строки', [F.text('title', 'Название'), F.text('sub', 'Подпись мелкими буквами'), F.area('text', 'Описание'), F.row(F.text('price', 'Цена'), F.text('note', 'Под ценой'))],
        { title: r => [r.title, r.sub].filter(Boolean).join(' · ') + (r.price ? ' — ' + r.price : ''), item: () => ({ title: '', sub: '', text: '', price: '', note: '' }), addLabel: 'Добавить строку' }),
      F.area('note', 'Примечание под таблицей'),
    ],
  },
  cols: {
    name: 'Две колонки списков', desc: 'Например «Что у нас есть» и «Чего у нас нет»',
    make: () => ({ leftTitle: '', left: [''], rightTitle: '', right: [''] }), sum: b => [b.leftTitle, b.rightTitle].filter(Boolean).join(' / '),
    fields: [F.text('leftTitle', 'Левая колонка: заголовок'), F.strs('left', 'Пункты слева'), F.text('rightTitle', 'Правая колонка: заголовок'), F.strs('right', 'Пункты справа (серые)')],
  },
  reviews: {
    name: 'Отзывы', desc: 'Общая оценка и цитаты гостей',
    make: () => ({ rating: '', ratingTitle: '', ratingText: '', items: [] }), sum: b => `${(b.items || []).length} отзывов`,
    fields: [
      F.row(F.text('rating', 'Оценка', { ph: '5,0' }), F.text('ratingTitle', 'Подпись к оценке')),
      F.text('ratingText', 'Пояснение под подписью'),
      F.list('items', 'Отзывы', [F.area('text', 'Текст отзыва', { rows: 3 }), F.row(F.text('author', 'Автор'), F.text('date', 'Когда')), F.text('source', 'Откуда (2ГИС, Яндекс…)')],
        { title: r => [r.author, cut(r.text, 40)].filter(Boolean).join(': '), item: () => ({ text: '«»', author: '', date: '', source: '' }), addLabel: 'Добавить отзыв' }),
    ],
  },
  buttons: {
    name: 'Кнопки', desc: 'Одна или несколько кнопок-ссылок',
    make: () => ({ items: [{ label: 'Забронировать', link: 'call', url: '', style: 'dark' }] }), sum: b => (b.items || []).map(i => i.label).join(', '),
    fields: [btnList('items', 'Кнопки')],
  },
  contacts: {
    name: 'Контакты и вопросы', desc: 'Телефон, мессенджеры, адрес и раскрывающиеся вопросы',
    make: () => ({ bigPhone: true, faq: [] }), sum: b => `${(b.faq || []).length} вопросов`,
    fields: [
      F.note('Телефон, мессенджеры, почта и адрес берутся из раздела «Контакты и кнопки».'),
      F.bool('bigPhone', 'Крупный номер телефона над контактами'),
      F.list('faq', 'Частые вопросы', [F.text('q', 'Вопрос'), F.area('a', 'Ответ', { rows: 3 })], { title: q => q.q, item: () => ({ q: 'Новый вопрос', a: '' }), addLabel: 'Добавить вопрос' }),
    ],
  },
};

const anchors = () => ['#top', ...S.content.sections.filter(s => s.id).map(s => '#' + s.id)];
const FORMAT_HELP = h('details', { class: 'help', style: 'margin-bottom:14px' },
  h('summary', {}, 'Как оформлять текст'),
  h('ul', {},
    h('li', {}, '*слово* — курсив (в заголовках — фирменным цветом)'),
    h('li', {}, '**слово** — жирный'),
    h('li', {}, '[текст ссылки](https://адрес) — ссылка'),
    h('li', {}, 'Пустая строка — новый абзац, Enter — перенос строки'),
    h('li', {}, '{телефон}, {max}, {telegram}, {почта} — подставятся из контактов')));

const VIEWS = {
  contacts: {
    title: 'Контакты и кнопки',
    intro: 'Эти данные используются по всему сайту: в шапке, кнопках, блоке контактов, подвале и данных для поисковиков. Поменяли здесь — поменялось везде.',
    groups: c => [
      { title: 'Связь', obj: c.contacts, fields: [
        F.row(F.text('phone', 'Телефон', { hint: 'Как показывать, например +7 908 77-88-110' }), F.text('phoneNote', 'Подпись')),
        F.row(F.text('max', 'MAX'), F.text('maxNote', 'Подпись')),
        F.row(F.text('telegram', 'Telegram', { hint: 'Имя без @, например zaryaolhon' }), F.text('telegramNote', 'Подпись')),
        F.row(F.text('email', 'Почта'), F.text('emailNote', 'Подпись')),
      ] },
      { title: 'Адрес и заезд', obj: c.contacts, fields: [
        F.row(F.text('address', 'Адрес'), F.text('addressNote', 'Уточнение')),
        F.area('addressShort', 'Адрес в подвале', { hint: 'Можно в две строки' }),
        F.row(F.text('checkin', 'Заезд и выезд'), F.text('checkinNote', 'Подпись')),
        F.area('checkinShort', 'Заезд в подвале'),
      ] },
      { title: 'Кнопки', obj: c.contacts, fields: [
        F.row(F.text('bookLabel', 'Кнопка звонка'), F.text('askLabel', 'Кнопка вопроса (Telegram)')),
      ] },
      { title: 'Названия строк в блоке контактов', obj: c.contacts.labels, fields: [
        F.row(F.text('phone', 'Телефон'), F.text('max', 'MAX')),
        F.row(F.text('telegram', 'Telegram'), F.text('email', 'Почта')),
        F.row(F.text('address', 'Адрес'), F.text('checkin', 'Заезд')),
      ] },
    ],
  },
  header: {
    title: 'Шапка и меню',
    groups: c => [
      { title: 'Логотип и название', obj: c.brand, fields: [
        F.img('logo', 'Логотип в шапке', { kind: 'logo', hint: 'Лучше PNG с прозрачным фоном' }),
        F.row(F.text('name', 'Название'), F.text('tagline', 'Подпись под названием')),
      ] },
      { title: 'Пункты меню', obj: c, note: 'Кнопка «Забронировать» в шапке звонит на телефон из раздела «Контакты и кнопки». «Куда ведёт» — якорь раздела (задаётся в настройках раздела).', fields: [
        F.list('nav', 'Пункты', [
          F.text('href', 'Куда ведёт', { list: anchors, hint: 'Например #nomera или полная ссылка https://…' }),
          F.row(F.text('short', 'Название в шапке (коротко)'), F.text('long', 'Название в мобильном меню и подвале')),
          F.bool('header', 'Показывать в шапке на компьютере'), F.bool('mobile', 'Показывать в мобильном меню'), F.bool('footer', 'Показывать в подвале'),
        ], { title: n => `${n.long || n.short || 'Пункт'}  ${n.href || ''}`, item: () => ({ href: '#', short: '', long: '', header: true, mobile: true, footer: false }), addLabel: 'Добавить пункт' }),
      ] },
    ],
  },
  hero: {
    title: 'Первый экран',
    help: true,
    groups: c => [
      { title: 'Эмблема', obj: c.brand, fields: [
        F.img('emblem', 'Эмблема (на первом экране и в подвале)', { kind: 'emblem', hint: 'PNG с прозрачным фоном' }),
        F.text('emblemAlt', 'Описание эмблемы'),
      ] },
      { title: 'Текст и фото', obj: c.hero, fields: [
        F.text('kicker', 'Надзаголовок'),
        F.area('title', 'Главный заголовок', { hint: 'Слова в *звёздочках* — курсивом и другим цветом' }),
        F.img('image', 'Главное фото', { alt: 'alt' }),
        F.text('caption', 'Подпись под фото'),
      ] },
    ],
  },
  footer: {
    title: 'Подвал',
    intro: 'Пункты «Разделы» настраиваются в «Шапка и меню», контакты — в «Контакты и кнопки». Эмблема — та же, что на первом экране.',
    groups: c => [
      { obj: c.footer, fields: [
        F.area('about', 'Текст под эмблемой'),
        F.row(F.text('sectionsTitle', 'Заголовок колонки разделов'), F.text('contactsTitle', 'Заголовок колонки контактов')),
        F.text('copyright', 'Копирайт', { hint: '«©» и текущий год подставятся сами' }),
        F.text('disclaimer', 'Строка справа внизу'),
      ] },
      { title: 'Мелочи', obj: c.ui, fields: [F.text('swipe', 'Подсказка под галереями на телефоне')] },
    ],
  },
  seo: {
    title: 'SEO и соцсети',
    groups: c => [
      { title: 'Поисковики', obj: c.meta, fields: [
        F.text('title', 'Заголовок страницы', { max: 70, hint: 'Виден во вкладке браузера и в выдаче Яндекса/Google' }),
        F.area('description', 'Описание', { max: 170, hint: 'Текст под ссылкой в поисковой выдаче' }),
        F.area('keywords', 'Ключевые слова', { hint: 'Через запятую' }),
      ] },
      { title: 'Превью в соцсетях и мессенджерах', obj: c.meta, fields: [
        F.text('siteName', 'Название сайта'),
        F.text('ogTitle', 'Заголовок превью'),
        F.area('ogDescription', 'Описание превью'),
        F.img('ogImage', 'Картинка превью', { kind: 'og', hint: 'Обрежется до 1200×630 автоматически' }),
      ] },
      { title: 'Иконка сайта', obj: c.brand, fields: [
        F.img('favicon', 'Иконка во вкладке и на экране iPhone', { kind: 'favicon', hint: 'Квадратная картинка, лучше PNG с прозрачным фоном' }),
      ] },
      { title: 'Данные об объекте для Яндекса и Google', obj: c.schema, note: 'Эти данные не видны на странице — их читают поисковики, чтобы показать рейтинг, адрес и цены в выдаче.', fields: [
        F.sel('type', 'Тип', [['BedAndBreakfast', 'Гостевой дом'], ['Hotel', 'Отель'], ['Hostel', 'Хостел'], ['Motel', 'Мотель'], ['LodgingBusiness', 'Жильё (общее)']]),
        F.text('name', 'Название'), F.text('alternateName', 'Другие названия', { hint: 'Через запятую' }),
        F.area('description', 'Описание'),
        F.row(F.text('ratingValue', 'Рейтинг', { ph: '5.0' }), F.text('reviewCount', 'Количество отзывов')),
        F.row(F.text('priceRange', 'Цены', { ph: 'от 10 000 ₽' }), F.text('numberOfRooms', 'Количество номеров')),
        F.row(F.text('checkinTime', 'Заезд с', { ph: '14:00' }), F.text('checkoutTime', 'Выезд до', { ph: '12:00' })),
        F.text('petsAllowed', 'Животные'),
        F.text('streetAddress', 'Улица и дом'),
        F.row(F.text('locality', 'Населённый пункт'), F.text('region', 'Регион')),
        F.area('sameAs', 'Ссылки на карточки (2ГИС, Яндекс Карты…)', { hint: 'Каждая с новой строки' }),
        F.strs('amenities', 'Удобства'),
        F.list('offers', 'Предложения и цены', [F.text('name', 'Название'), F.row(F.text('price', 'Цена, ₽ (только число)'), F.text('description', 'Пояснение'))],
          { title: o => o.name + (o.price ? ' — ' + o.price + ' ₽' : ''), item: () => ({ name: '', price: '', description: '' }), addLabel: 'Добавить предложение' }),
      ] },
    ],
  },
  design: {
    title: 'Цвета',
    intro: 'Цвета применяются ко всему сайту. Если что-то пошло не так — кнопка «Вернуть фирменные цвета» внизу.',
    groups: c => [
      { obj: c.colors, fields: [
        F.color('paper', 'Основной фон (молочный)'), F.color('sand', 'Второй фон (песочный)'),
        F.color('ink', 'Текст и тёмные кнопки'), F.color('sage', 'Надзаголовки'), F.color('baikal', 'Курсив в заголовках и цены'),
      ], extra: h('button', { type: 'button', class: 'btn', onclick: () => {
        beforeChange();
        Object.assign(S.content.colors, { paper: '#F5F1E8', sand: '#D8CCB8', ink: '#252522', sage: '#788078', baikal: '#35454A' });
        changed(true);
      } }, 'Вернуть фирменные цвета') },
    ],
  },
  settings: {
    title: 'Подключение и файлы',
    groups: c => [
      { title: 'Репозиторий', obj: c.admin, note: S.mode === 'github' ? `Вы вошли в ${S.auth.repo}, ветка ${S.auth.branch}.` : 'Вы в режиме просмотра: изменения можно смотреть, но не публиковать.', fields: [
        F.text('repo', 'Репозиторий на GitHub', { hint: 'имя-аккаунта/название — подставляется при настройке входа' }),
        F.text('branch', 'Ветка'),
      ] },
      { title: 'Адрес сайта', obj: c.meta, fields: [
        F.text('siteUrl', 'Адрес сайта', { hint: 'Полный адрес с https://. Нужен поисковикам и для превью в соцсетях.' }),
      ] },
      { title: 'Файлы', obj: {}, fields: [], extra: h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' },
        h('button', { type: 'button', class: 'btn', onclick: downloadJson }, 'Скачать резервную копию'),
        h('button', { type: 'button', class: 'btn', onclick: importJson }, 'Загрузить из файла'),
        h('button', { type: 'button', class: 'btn btn--danger', onclick: discardAll }, 'Отменить все неопубликованные правки'),
        h('button', { type: 'button', class: 'btn', onclick: changePassword }, 'Сменить пароль'),
        h('button', { type: 'button', class: 'btn', onclick: logout }, S.mode === 'github' ? 'Выйти' : 'Войти')) },
    ],
  },
};

/* ───────── отрисовка полей ───────── */
function renderFields(obj, fields, ctx = {}) {
  const out = [];
  for (const f of fields) {
    if (f.show && !f.show(obj)) continue;
    const el = FIELD[f.t](obj, f, ctx);
    if (el) out.push(el);
  }
  return out;
}
function textInput(obj, f, tag) {
  const el = h(tag, { value: obj[f.k] ?? '', placeholder: f.ph || null, rows: tag === 'textarea' ? Math.max(f.rows || 2, String(obj[f.k] || '').split('\n').length) : null, spellcheck: f.code ? 'false' : null });
  el.addEventListener('input', () => { beforeChange(); obj[f.k] = f.clean ? f.clean(el.value) : el.value; if (f.clean && el.value !== obj[f.k]) el.value = obj[f.k]; changed(false); });
  return el;
}
const FIELD = {
  text(obj, f) {
    const inp = textInput(obj, f, 'input');
    let dl = null;
    if (f.list) { const id = 'dl' + Math.random().toString(36).slice(2); inp.setAttribute('list', id); dl = h('datalist', { id }, f.list().map(v => h('option', { value: v }))); }
    if (f.onchange) inp.addEventListener('change', () => f.onchange(obj, inp));
    if (f.onfocus) inp.addEventListener('focus', () => f.onfocus(obj, inp));
    return h('label', { class: 'fld' }, h('span', {}, f.label, counter(inp, f)), inp, dl, f.hint && h('div', { class: 'hint' }, f.hint));
  },
  area(obj, f) {
    const ta = textInput(obj, f, 'textarea');
    const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 2 + 'px'; };
    ta.addEventListener('input', grow); requestAnimationFrame(grow);
    return h('label', { class: 'fld' }, h('span', {}, f.label, counter(ta, f)), ta, f.hint && h('div', { class: 'hint' }, f.hint));
  },
  sel(obj, f) {
    const s = h('select', {}, f.opts.map(([v, l]) => h('option', { value: v }, l)));
    s.value = obj[f.k] ?? f.opts[0][0];
    if (s.value !== String(obj[f.k] ?? '')) s.value = f.opts[0][0];
    s.addEventListener('change', () => { beforeChange(); obj[f.k] = s.value; changed(!!f.rerender); });
    return h('label', { class: 'fld' }, h('span', {}, f.label), s, f.hint && h('div', { class: 'hint' }, f.hint));
  },
  bool(obj, f) {
    const c = h('input', { type: 'checkbox', checked: !!obj[f.k] });
    c.addEventListener('change', () => { beforeChange(); obj[f.k] = c.checked; changed(!!f.rerender); });
    return h('label', { class: 'chk' }, c, f.label);
  },
  color(obj, f) {
    const pick = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(obj[f.k] || '') ? obj[f.k] : '#000000' });
    const txt = h('input', { value: obj[f.k] || '', spellcheck: 'false', style: 'max-width:140px' });
    pick.addEventListener('input', () => { beforeChange(); obj[f.k] = pick.value.toUpperCase(); txt.value = obj[f.k]; changed(false); });
    txt.addEventListener('input', () => { beforeChange(); obj[f.k] = txt.value.trim(); if (/^#[0-9a-f]{6}$/i.test(obj[f.k])) pick.value = obj[f.k]; changed(false); });
    return h('label', { class: 'fld' }, h('span', {}, f.label), h('div', { class: 'color' }, pick, txt));
  },
  note: (obj, f) => h('p', { class: 'note' + (f.warn ? ' warn' : '') }, f.text),
  row: (obj, f, ctx) => h('div', { class: 'row2' }, renderFields(obj, f.fields, ctx)),
  group: (obj, f, ctx) => {
    if (!obj[f.k]) obj[f.k] = {};  // пустой объект ничего не меняет в выводе, но нужен полям внутри
    return h('div', {}, h('h3', { text: f.label, style: 'font-size:14px;margin:6px 0 10px' }), renderFields(obj[f.k], f.fields, ctx));
  },
  img(obj, f, ctx) {
    const isIcon = ['logo', 'emblem', 'favicon'].includes(f.kind);
    const th = h('div', { class: 'th' + (isIcon ? ' contain' : ''), title: 'Можно перетащить фото сюда' });
    const paint = () => {
      const p = obj[f.k];
      th.classList.toggle('empty', !p);
      th.style.backgroundImage = p ? `url("${thumbUrl(p)}")` : '';
      th.textContent = p ? '' : 'нет фото';
    };
    const busy = h('div', { class: 'busy', hidden: true });
    const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
    const upload = async fl => {
      busy.hidden = false; busy.textContent = 'Обрабатываю фото…';
      try {
        if (f.kind === 'favicon') {
          const { ico, touch } = await makeIcons(fl);
          beforeChange();
          const a = newPath('favicon', 'png'), b = newPath('touch-icon', 'png');
          addPending(a, ico, 64, 64); addPending(b, touch, 180, 180);
          obj.favicon = a; obj.touchIcon = b;
        } else {
          const p = await uploadPhoto(fl, f.kind, f.kind === 'og' ? 'og' : ctx.slug || f.kind || 'foto');
          beforeChange(); obj[f.k] = p;
        }
        paint(); changed(true);
        toast('Фото добавлено. Оно появится на сайте после публикации.');
      } catch (e) { toast(e.message, true); }
      finally { busy.hidden = true; }
    };
    file.addEventListener('change', () => { const fl = file.files[0]; file.value = ''; if (fl) upload(fl); });
    th.addEventListener('dragover', e => e.preventDefault());
    th.addEventListener('drop', e => { e.preventDefault(); const fl = e.dataTransfer.files[0]; if (fl) upload(fl); });
    paint();
    return h('div', { class: 'imgf' }, th, h('div', { class: 'ctl' },
      h('div', { class: 'lbl', text: f.label }),
      h('div', { class: 'btns' },
        h('button', { type: 'button', class: 'btn btn--sm', onclick: () => file.click() }, obj[f.k] ? 'Заменить' : 'Загрузить'),
        f.optional && obj[f.k] ? h('button', { type: 'button', class: 'btn btn--sm btn--danger', onclick: () => { beforeChange(); obj[f.k] = ''; changed(true); } }, 'Убрать фото') : null),
      busy, f.hint && h('div', { class: 'hint muted small' }, f.hint),
      f.alt ? FIELD.text(obj, F.text(f.alt, 'Подпись к фото', { hint: ALT_HINT })) : null), file);
  },
  list(obj, f, ctx) {
    // пока список пуст и не тронут, в данные ничего не записываем — иначе простое открытие раздела считалось бы правкой
    const arr = Array.isArray(obj[f.k]) ? obj[f.k] : [];
    const attach = () => { if (!Array.isArray(obj[f.k])) obj[f.k] = arr; };
    const wrap = h('div', { class: 'list' }, h('div', { class: 'lh' }, h('span', {}, f.label, ' ', h('span', { class: 'muted', text: `(${arr.length})` }))));
    arr.forEach((it, i) => wrap.append(f.compact ? compactItem(arr, i, f) : cardItem(arr, i, f, ctx)));
    const inf = f.info?.(arr);
    if (inf) wrap.append(h('div', { class: 'rows-info' + (inf.bad ? ' bad' : ''), text: inf.text }));
    const tools = h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' },
      h('button', { type: 'button', class: 'btn btn--sm', onclick: () => { beforeChange(); attach(); const it = f.item ? f.item() : {}; arr.push(it); if (typeof it === 'object') S.open.add(it); changed(true); } }, '＋ ' + (f.addLabel || 'Добавить')));
    if (f.multi) {
      const inp = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
      const btn = h('button', { type: 'button', class: 'btn btn--sm', onclick: () => inp.click() }, '＋ Несколько фото сразу');
      inp.addEventListener('change', async () => {
        const files = [...inp.files]; inp.value = '';
        btn.disabled = true;
        let n = 0;
        for (const fl of files) {
          btn.textContent = `Обрабатываю ${++n} из ${files.length}…`;
          try { const p = await uploadPhoto(fl, 'photo', ctx.slug || 'foto'); beforeChange(); attach(); const it = f.item(); it.image = p; arr.push(it); }
          catch (e) { toast(e.message, true); }
        }
        changed(true);
        toast(`Добавлено фото: ${files.length}. Подпишите их и опубликуйте.`);
      });
      tools.append(btn, inp);
    }
    wrap.append(tools);
    return wrap;
  },
  strs(obj, f) {
    return FIELD.list(obj, { ...f, t: 'list', compact: true, strings: true, item: () => '', addLabel: 'Добавить пункт' });
  },
};
function counter(inp, f) {
  if (!f.max) return null;
  const em = h('em');
  const upd = () => { const n = inp.value.length; em.textContent = `${n} / ${f.max}`; em.className = n > f.max ? 'over' : ''; };
  inp.addEventListener('input', upd); upd();
  return em;
}
function itemControls(arr, i, { copy = true } = {}) {
  const mv = d => () => { const j = i + d; if (j < 0 || j >= arr.length) return; beforeChange(); [arr[i], arr[j]] = [arr[j], arr[i]]; changed(true); };
  return [
    h('button', { type: 'button', class: 'icon-btn', title: 'Выше', 'aria-label': 'Выше', disabled: i === 0, onclick: mv(-1) }, '↑'),
    h('button', { type: 'button', class: 'icon-btn', title: 'Ниже', 'aria-label': 'Ниже', disabled: i === arr.length - 1, onclick: mv(1) }, '↓'),
    copy ? h('button', { type: 'button', class: 'icon-btn', title: 'Сделать копию', 'aria-label': 'Копия', onclick: () => { beforeChange(); arr.splice(i + 1, 0, clone(arr[i])); changed(true); } }, '⧉') : null,
    h('button', { type: 'button', class: 'icon-btn', title: 'Удалить', 'aria-label': 'Удалить', onclick: () => { beforeChange(); arr.splice(i, 1); changed(true); toast('Удалено. Вернуть можно кнопкой ↶ вверху.'); } }, '✕'),
  ];
}
function cardItem(arr, i, f, ctx) {
  const it = arr[i];
  const el = h('div', { class: 'item' + (S.open.has(it) ? '' : ' closed') });
  const title = () => cut(f.title?.(it, i)) || `${i + 1}-й элемент`;
  const t = h('div', { class: 't' }, h('small', { text: i + 1 + '.' }), title());
  const head = h('div', { class: 'ih', onclick: e => {
    if (e.target.closest('button')) return;
    el.classList.toggle('closed');
    el.classList.contains('closed') ? S.open.delete(it) : S.open.add(it);
  } }, f.thumb ? h('span', { class: 'tn', style: it[f.thumb] ? `background-image:url("${thumbUrl(it[f.thumb])}")` : '' }) : null, t, itemControls(arr, i));
  const body = h('div', { class: 'ib' }, renderFields(it, f.fields, ctx));
  body.addEventListener('input', () => { t.lastChild.textContent = title(); });
  el.append(head, body);
  return el;
}
function compactItem(arr, i, f) {
  const it = arr[i];
  const mk = (val, set, sf = {}) => {
    const el = h(sf.t === 'area' ? 'textarea' : 'input', { value: val ?? '', placeholder: sf.label || f.ph || '', rows: sf.t === 'area' ? 2 : null });
    el.addEventListener('input', () => { beforeChange(); set(el.value); changed(false); });
    return el;
  };
  const inputs = f.strings ? [mk(it, v => { arr[i] = v; })] : f.fields.map(sf => mk(it[sf.k], v => { it[sf.k] = v; }, sf));
  const cin = h('div', { class: 'cin' }, inputs);
  if (inputs.length > 1 && inputs.length <= 3 && !f.fields?.some(sf => sf.t === 'area')) cin.style.gridTemplateColumns = `repeat(${inputs.length},1fr)`;
  return h('div', { class: 'crow' }, cin, h('div', { class: 'ctl' }, itemControls(arr, i, { copy: false })));
}

/* ───────── экраны ───────── */
const sectionName = (s, i) => s.style === 'final' ? 'Финальный призыв' : plain(s.label) || cut(s.title, 34) || plain(s.blocks?.[0]?.label) || cut(s.blocks?.[0]?.h3, 34) || (s.id ? '#' + s.id : `Раздел ${i + 1}`);
function renderSide() {
  const side = $('#side');
  const b = (key, label, o = {}) => h('button', { type: 'button', class: [S.sel === key ? 'on' : '', o.off ? 'off' : ''].join(' '), onclick: () => select(key) }, o.n != null ? h('span', { class: 'n', text: o.n }) : null, label);
  side.replaceChildren(
    h('h4', { text: 'Общее' }), b('contacts', 'Контакты и кнопки'), b('header', 'Шапка и меню'), b('hero', 'Первый экран'),
    h('h4', { text: 'Разделы страницы' }),
    ...S.content.sections.map((s, i) => b('s:' + i, sectionName(s, i), { n: i + 1, off: s.hidden })),
    h('button', { type: 'button', class: 'add', onclick: addSection }, '＋ Добавить раздел'),
    h('h4', { text: 'Низ страницы' }), b('footer', 'Подвал'),
    h('h4', { text: 'Настройки' }), b('seo', 'SEO и соцсети'), b('design', 'Цвета'), b('history', 'История изменений'), b('settings', 'Подключение и файлы'));
}
let lastView = '';
function renderEditor() {
  const ed = $('#editor');
  const keep = lastView === S.sel ? ed.scrollTop : 0;
  lastView = S.sel;
  ed.replaceChildren();
  const m = /^s:(\d+)$/.exec(S.sel);
  if (m) renderSection(ed, +m[1]);
  else if (S.sel === 'history') renderHistory(ed);
  else {
    const v = VIEWS[S.sel];
    ed.append(h('div', { class: 'ed-head' }, h('h2', { text: v.title })));
    if (v.intro) ed.append(h('p', { class: 'note', text: v.intro }));
    if (v.help) ed.append(FORMAT_HELP);
    for (const g of v.groups(S.content)) {
      ed.append(h('div', { class: 'card' }, g.title && h('h3', { text: g.title }), g.note && h('p', { class: 'note', text: g.note }), renderFields(g.obj, g.fields, { slug: S.sel }), g.extra));
    }
  }
  ed.scrollTop = keep;
}
function renderSection(ed, i) {
  const secs = S.content.sections, s = secs[i];
  const move = d => () => { const j = i + d; if (j < 0 || j >= secs.length) return; beforeChange(); [secs[i], secs[j]] = [secs[j], secs[i]]; S.sel = 's:' + j; changed(true); };
  ed.append(h('div', { class: 'ed-head' }, h('h2', { text: sectionName(s, i) }), h('div', { class: 'acts' },
    h('button', { type: 'button', class: 'icon-btn', title: 'Переместить выше', disabled: i === 0, onclick: move(-1) }, '↑'),
    h('button', { type: 'button', class: 'icon-btn', title: 'Переместить ниже', disabled: i === secs.length - 1, onclick: move(1) }, '↓'),
    h('button', { type: 'button', class: 'icon-btn', title: 'Копия раздела', onclick: () => {
      beforeChange(); const c = clone(s); if (c.id) c.id += '-2'; secs.splice(i + 1, 0, c); S.sel = 's:' + (i + 1); changed(true);
    } }, '⧉'),
    h('button', { type: 'button', class: 'icon-btn', title: 'Удалить раздел', onclick: async () => {
      if (!(await confirmDo('Удалить раздел?', `Раздел «${sectionName(s, i)}» исчезнет со страницы. До публикации его можно вернуть кнопкой ↶.`, 'Удалить'))) return;
      beforeChange(); secs.splice(i, 1); S.sel = secs.length ? 's:' + Math.min(i, secs.length - 1) : 'hero'; changed(true);
    } }, '✕'))));
  if (s.hidden) ed.append(h('p', { class: 'note warn', text: 'Раздел скрыт — на сайте его не видно.' }));
  ed.append(FORMAT_HELP);
  const idField = F.text('id', 'Якорь раздела (для ссылок из меню)', {
    clean: v => slug(v), code: true, hint: 'Латиницей, например nomera → пункт меню «#nomera». Можно оставить пустым.',
    onfocus: (o, inp) => { inp.dataset.old = o.id || ''; },
    onchange: (o, inp) => {
      o.id = (o.id || '').replace(/-+$/, ''); inp.value = o.id;
      const old = inp.dataset.old;
      if (old && old !== o.id) S.content.nav.forEach(n => { if (n.href === '#' + old) n.href = o.id ? '#' + o.id : '#'; });
      changed(false);
    },
  });
  ed.append(
    h('div', { class: 'card' }, h('h3', { text: 'Заголовок раздела' }), renderFields(s, [
      F.text('label', 'Надзаголовок (мелкими буквами)'),
      F.area('title', 'Заголовок', { hint: 'Слова в *звёздочках* — курсивом и другим цветом. Enter — перенос строки.' }),
      F.area('lead', s.style === 'final' ? 'Текст под заголовком' : 'Вводный текст справа от заголовка'),
    ], { slug: s.id })),
    h('div', { class: 'card' }, h('h3', { text: 'Настройки раздела' }), renderFields(s, [
      idField,
      F.row(F.sel('bg', 'Фон', [['paper', 'Молочный'], ['sand', 'Песочный']]), F.sel('style', 'Вид', [['', 'Обычный'], ['final', 'Призыв по центру с кнопками']], { rerender: true })),
      F.bool('hidden', 'Скрыть раздел на сайте', { rerender: true }),
    ], { slug: s.id })));
  const blocks = h('div', { class: 'list blocks' });
  s.blocks.forEach((b, bi) => blocks.append(blockCard(s, i, bi)));
  ed.append(h('h3', { text: 'Блоки раздела', style: 'font-size:15px;margin:22px 0 10px' }), blocks,
    h('button', { type: 'button', class: 'btn', onclick: () => addBlock(s, i) }, '＋ Добавить блок'));
}
function blockCard(s, si, bi) {
  const b = s.blocks[bi], T = BLOCKS[b.type] || { name: b.type, fields: [], sum: () => '' };
  const el = h('div', { class: 'item' + (S.open.has(b) ? '' : ' closed') + (b.hidden ? ' hid' : ''), id: `blk-${si}-${bi}` });
  const t = h('div', { class: 't' }, h('small', { text: T.name }), cut(T.sum(b), 60));
  const head = h('div', { class: 'ih', onclick: e => {
    if (e.target.closest('button')) return;
    el.classList.toggle('closed');
    el.classList.contains('closed') ? S.open.delete(b) : S.open.add(b);
  } }, t,
    h('button', { type: 'button', class: 'icon-btn', title: b.hidden ? 'Показать на сайте' : 'Скрыть на сайте', onclick: () => { beforeChange(); b.hidden = !b.hidden; changed(true); } }, b.hidden ? '◌' : '◉'),
    itemControls(s.blocks, bi));
  const body = h('div', { class: 'ib' },
    renderFields(b, [F.sel('space', 'Отступ сверху', SPACES), ...T.fields], { slug: s.id || 'foto' }));
  body.addEventListener('input', () => { t.lastChild.textContent = cut(T.sum(b), 60); });
  el.append(head, body);
  return el;
}
async function addBlock(s, si) {
  let pick;
  const picked = new Promise(r => { pick = r; });
  const k = await Promise.race([picked, dialog('Какой блок добавить?', h('div', { class: 'picker' },
    Object.entries(BLOCKS).map(([key, T]) => h('button', { type: 'button', onclick: () => pick(key) }, h('b', { text: T.name }), h('span', { text: T.desc })))),
  [{ label: 'Отмена', value: null }])]);
  $('#modal').hidden = true;
  if (!k) return;
  beforeChange();
  const b = { type: k, space: s.blocks.length ? 'm' : '0', ...BLOCKS[k].make() };
  s.blocks.push(b); S.open.add(b);
  changed(true);
  requestAnimationFrame(() => document.getElementById(`blk-${si}-${s.blocks.length - 1}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}
function addSection() {
  const secs = S.content.sections;
  beforeChange();
  const at = secs.length && secs[secs.length - 1].style === 'final' ? secs.length - 1 : secs.length;
  const prev = secs[at - 1];
  let id = 'razdel', n = 2;
  while (secs.some(s => s.id === id)) id = 'razdel-' + n++;
  const s = { id, bg: prev?.bg === 'paper' ? 'sand' : 'paper', label: 'Новый раздел', title: 'Заголовок *раздела*', lead: '', blocks: [{ type: 'text', space: '0', big: '', text: 'Текст раздела' }] };
  secs.splice(at, 0, s);
  S.sel = 's:' + at;
  changed(true);
  toast('Раздел добавлен. Чтобы он появился в меню, добавьте пункт в «Шапка и меню».');
}

/* ───────── история ───────── */
async function renderHistory(ed) {
  ed.append(h('div', { class: 'ed-head' }, h('h2', { text: 'История изменений' })),
    h('p', { class: 'note', text: 'Каждая публикация сохраняется на GitHub. Можно открыть любую прошлую версию и опубликовать её снова — сайт вернётся к ней целиком, вместе с фото.' }));
  if (S.mode !== 'github') { ed.append(h('p', { class: 'muted', text: 'История доступна после входа.' })); return; }
  const list = h('div', { class: 'hist' }, h('p', { class: 'muted', text: 'Загружаю…' }));
  ed.append(list);
  try {
    const commits = await gh(rp(`/commits?path=content.json&sha=${encodeURIComponent(S.auth.branch)}&per_page=40`));
    list.replaceChildren(...commits.map((cm, i) => h('div', { class: 'item' },
      h('div', {}, cm.commit.message.split('\n')[0], h('small', { text: fmtDate(cm.commit.author.date) + (cm.commit.author.name ? ' · ' + cm.commit.author.name : '') })),
      i === 0 ? h('span', { class: 'muted small', text: 'сейчас на сайте' })
        : h('button', { type: 'button', class: 'btn btn--sm', onclick: () => openVersion(cm.sha, cm.commit.author.date) }, 'Открыть'))));
    if (!commits.length) list.replaceChildren(h('p', { class: 'muted', text: 'Пока нет публикаций.' }));
  } catch (e) { list.replaceChildren(h('p', { class: 'err', text: e.message })); }
}
async function openVersion(sha, date) {
  if (isDirty() && !(await confirmDo('Заменить текущие правки?', 'Неопубликованные изменения будут заменены выбранной версией.', 'Заменить'))) return;
  try {
    toast('Загружаю версию…');
    const c = normalize(JSON.parse((await loadRemote(sha)).json));
    const [old, cur] = await Promise.all([treeFiles(sha), treeFiles(S.headSha)]);
    S.restore.clear();
    for (const p of usedFiles(c)) if (!cur.files.has(p) && old.files.has(p)) S.restore.set(p, old.files.get(p));
    await loadRestoreUrls();
    beforeChange(); lastSnap = 0;
    c.build = S.content.build;  // стили и скрипт берём текущие
    S.content = c; S.sel = 'hero';
    changed(true);
    toast(`Открыта версия от ${fmtDate(date)}. Нажмите «Опубликовать», чтобы вернуть её на сайт.`);
  } catch (e) { toast(e.message, true); }
}

/* ───────── файлы ───────── */
function downloadJson() {
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(S.content, null, 2)], { type: 'application/json' })), download: `content-${new Date().toISOString().slice(0, 10)}.json` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function importJson() {
  const inp = h('input', { type: 'file', accept: '.json,application/json' });
  inp.addEventListener('change', async () => {
    try {
      const c = normalize(JSON.parse(await inp.files[0].text()));
      if (!Array.isArray(c.sections)) throw new Error();
      beforeChange(); lastSnap = 0; c.build = S.content.build; S.content = c; S.sel = 'hero'; changed(true);
      toast('Загружено. Проверьте и опубликуйте.');
    } catch { toast('Это не файл content.json от сайта.', true); }
  });
  inp.click();
}
async function discardAll() {
  if (!isDirty()) return toast('Неопубликованных правок нет.');
  if (!(await confirmDo('Отменить все правки?', 'Вернётся версия, которая сейчас на сайте.', 'Отменить правки'))) return;
  beforeChange(); lastSnap = 0;
  S.content = normalize(JSON.parse(S.baseJson)); S.restore.clear(); fixSel(); changed(true);
}
function logout() {
  keyStore.clear();
  if (S.mode === 'github') { S.hint = { repo: S.auth.repo, branch: S.auth.branch }; S.auth = null; S.mode = 'demo'; }
  showLogin();
}
function fieldBox(label, input) { return h('label', { class: 'fld' }, h('span', { text: label }), input); }
async function changePassword() {
  if (S.mode !== 'github') return toast('Сначала войдите в админку.', true);
  const a = h('input', { type: 'password', autocomplete: 'new-password' }), b = h('input', { type: 'password', autocomplete: 'new-password' });
  const gen = h('button', { type: 'button', class: 'btn btn--sm', onclick: () => { a.value = b.value = genPassword(); a.type = b.type = 'text'; } }, 'Придумать надёжный пароль');
  let msg = '';
  for (;;) {
    const ok = await dialog('Сменить пароль', [
      h('p', { class: 'muted', text: 'Не меньше 12 знаков. Новый пароль заработает на всех устройствах через 1–2 минуты; там, где вы уже вошли, ничего не изменится.' }),
      fieldBox('Новый пароль', a), fieldBox('Ещё раз', b), gen,
      h('p', { class: 'err', text: msg, hidden: !msg })],
    [{ label: 'Отмена', value: false }, { label: 'Сохранить', value: true, cls: 'btn--primary' }]);
    if (!ok) return;
    msg = a.value !== b.value ? 'Пароли не совпадают.' : weakPassword(a.value);
    if (!msg) break;
  }
  toast('Сохраняю…');
  try {
    const { vault, key } = await sealVault(S.auth, a.value);
    await saveVault(vault, 'Админка: новый пароль');
    if (await keyStore.get('vaultKey')) keyStore.put('vaultKey', { key, salt: vault.salt });
    toast('Пароль изменён.');
  } catch (e) { toast(e.message, true); }
}

/* ───────── публикация ───────── */
function validate(c) {
  const out = [];
  const ids = c.sections.filter(s => !s.hidden && s.id).map(s => s.id);
  const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (dup.length) out.push(`Одинаковый якорь у нескольких разделов: #${[...new Set(dup)].join(', #')}`);
  for (const n of c.nav) {
    if ((n.header || n.mobile || n.footer) && /^#./.test(n.href || '') && n.href !== '#top' && !ids.includes(n.href.slice(1)))
      out.push(`Пункт меню «${n.long || n.short}» ведёт на ${n.href}, а такого видимого раздела нет.`);
  }
  let noAlt = 0, noImg = 0;
  const walk = v => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      if ('image' in v && 'alt' in v) { if (v.image && !String(v.alt || '').trim()) noAlt++; }
      if ('image' in v && 'alt' in v && !v.image && v.type !== 'duo') noImg++;
      Object.values(v).forEach(walk);
    }
  };
  walk(c.sections); walk(c.hero);
  if (noImg) out.push(`Блоков без фото: ${noImg} — на сайте там будет пустое место.`);
  if (noAlt) out.push(`Фото без подписи: ${noAlt}. Подписи помогают поисковикам.`);
  if ((c.meta.title || '').length > 70) out.push('Заголовок страницы для поисковиков длиннее 70 знаков — в выдаче его обрежут.');
  return out;
}
async function publish() {
  if (S.mode !== 'github') return showLogin();
  if (!isDirty()) return toast('Изменений нет — публиковать нечего.');
  const c = S.content;
  const used = usedFiles(c);
  const newImgs = [...S.pending.keys()].filter(p => used.has(p)).length;
  const warn = validate(c);
  const note = h('input', { placeholder: 'Например: зимние цены' });
  const ok = await dialog('Опубликовать изменения?', [
    'Изменения сохранятся на GitHub, и сайт обновится примерно через 1–2 минуты.',
    newImgs ? h('p', { text: `Новых фото: ${newImgs}.` }) : '',
    warn.length ? h('div', { class: 'note warn' }, h('b', { text: 'Обратите внимание' }), h('ul', {}, warn.map(w => h('li', { text: w })))) : '',
    h('label', { class: 'fld' }, h('span', { text: 'Что поменяли (необязательно, для истории)' }), note),
  ], [{ label: 'Отмена', value: false }, { label: 'Опубликовать', value: true, cls: 'btn--primary' }]);
  if (ok) await doPublish(note.value.trim());
}
async function doPublish(note) {
  const m = $('#modal'), card = $('#modalCard'), prog = h('div', { class: 'progress' });
  const step = text => {
    prog.querySelectorAll('div:not(.done)').forEach(d => { d.classList.add('done'); d.textContent = '✓ ' + d.textContent.slice(2); });
    prog.append(h('div', { text: '… ' + text }));
  };
  card.replaceChildren(h('h2', { text: 'Публикую…' }), prog); m.hidden = false; m.onclick = null;
  try {
    step('Проверяю, что сейчас на сайте');
    const head = await headSha();
    if (head !== S.headSha) {
      const cur = await loadRemote(head);
      if (cur.sha !== S.baseSha) {
        const go = await dialog('Сайт успел измениться', 'Пока вы редактировали, кто-то опубликовал другие правки — с другого устройства или прямо в GitHub. Если продолжить, ваша версия заменит их.',
          [{ label: 'Отмена', value: false }, { label: 'Всё равно опубликовать', value: true, cls: 'btn--primary' }]);
        if (!go) return;
        card.replaceChildren(h('h2', { text: 'Публикую…' }), prog); m.hidden = false; m.onclick = null;
      }
    }
    const c = clone(S.content);
    const used = usedFiles(c);
    for (const p of Object.keys(c.dims)) if (!used.has(p)) delete c.dims[p];
    const cur = await treeFiles(head);
    const tree = [];
    const uploads = [...S.pending].filter(([p]) => used.has(p) && !cur.files.has(p));
    for (let n = 0; n < uploads.length; n++) {
      const [path, { blob }] = uploads[n];
      step(`Загружаю фото ${n + 1} из ${uploads.length}`);
      const b = await gh(rp('/git/blobs'), { method: 'POST', body: JSON.stringify({ content: await blobToB64(blob), encoding: 'base64' }) });
      tree.push({ path, mode: '100644', type: 'blob', sha: b.sha });
    }
    for (const [path, sha] of S.restore) if (used.has(path) && !cur.files.has(path)) tree.push({ path, mode: '100644', type: 'blob', sha });
    step('Собираю страницу');
    tree.push({ path: 'content.json', mode: '100644', type: 'blob', content: JSON.stringify(c, null, 2) + '\n' });
    tree.push({ path: 'index.html', mode: '100644', type: 'blob', content: render(c) });
    // фото, на которые больше ничего не ссылается, удаляем из папки img/ (в истории GitHub они остаются)
    const removed = cur.truncated ? [] : [...cur.files.keys()].filter(p => p.startsWith('img/') && !used.has(p));
    for (const path of removed) tree.push({ path, mode: '100644', type: 'blob', sha: null });
    step('Сохраняю на GitHub');
    const nt = await gh(rp('/git/trees'), { method: 'POST', body: JSON.stringify({ base_tree: cur.treeSha, tree }) });
    const nc = await gh(rp('/git/commits'), { method: 'POST', body: JSON.stringify({ message: 'Правки через админку' + (note ? ': ' + note : ''), tree: nt.sha, parents: [head] }) });
    await gh(rp(`/git/refs/heads/${S.auth.branch}`), { method: 'PATCH', body: JSON.stringify({ sha: nc.sha }) });
    step('Готово');
    S.headSha = nc.sha;
    S.baseSha = (await gh(rp(`/contents/content.json?ref=${nc.sha}`)).catch(() => null))?.sha || null;
    S.content = c; S.baseJson = JSON.stringify(c);
    for (const v of S.pending.values()) URL.revokeObjectURL(v.url);
    S.pending.clear(); S.restore.clear(); S.restoreUrls.clear();
    idb.clear(); localStorage.removeItem(LS_DRAFT);
    card.replaceChildren(h('h2', { text: 'Опубликовано ✓' }),
      h('p', { text: 'Сайт обновится через 1–2 минуты. Если видите старую версию — подождите и обновите страницу (на компьютере Ctrl+F5).' }),
      removed.length ? h('p', { class: 'muted small', text: `Убрано неиспользуемых фото: ${removed.length} (в истории они сохранены).` }) : '',
      h('div', { class: 'acts' },
        h('a', { class: 'btn', href: ROOT, target: '_blank', rel: 'noopener' }, 'Открыть сайт'),
        h('button', { type: 'button', class: 'btn btn--primary', onclick: () => { m.hidden = true; } }, 'Продолжить')));
    changed(true);
  } catch (e) {
    card.replaceChildren(h('h2', { text: 'Не получилось опубликовать' }), h('p', { text: e.message }),
      h('p', { class: 'muted small', text: 'Ваши изменения не потеряны — они сохранены в этом браузере. Можно попробовать ещё раз.' }),
      h('div', { class: 'acts' }, h('button', { type: 'button', class: 'btn btn--primary', onclick: () => { m.hidden = true; } }, 'Понятно')));
  }
}

/* ───────── предпросмотр ───────── */
let pvT, pvW = +localStorage.getItem(LS_DEV) || (innerWidth < 760 ? 390 : 1366);
function schedulePreview() { clearTimeout(pvT); pvT = setTimeout(updatePreview, 300); }
function updatePreview() {
  const fr = $('#frame');
  let y = 0;
  try { y = fr.contentWindow.scrollY || 0; } catch {}
  fr.onload = () => {
    const d = fr.contentDocument;
    try { fr.contentWindow.scrollTo(0, y); } catch {}
    d.addEventListener('click', onPreviewClick, true);
    if (pendingScroll) { scrollPreview(pendingScroll); pendingScroll = null; }
  };
  fr.srcdoc = render(S.content, { preview: true, base: ROOT, asset: previewAsset });
}
let pendingScroll = null;
function scrollPreview(key) {
  const d = $('#frame').contentDocument;
  if (!d?.body) { pendingScroll = key; return; }
  const sel = key === 'header' ? null : key === 'hero' ? '#top' : key === 'footer' ? 'footer' : `[data-ed="${key}"]`;
  const el = sel && d.querySelector(sel);
  if (el) el.scrollIntoView({ block: 'start' }); else if (key === 'header') d.defaultView.scrollTo(0, 0);
}
function onPreviewClick(e) {
  const a = e.target.closest('a');
  if (a) e.preventDefault();
  const t = e.target.closest('[data-ed]');
  if (!t) return;
  e.preventDefault(); e.stopPropagation();
  const v = t.dataset.ed;
  const mb = /^b:(\d+):(\d+)$/.exec(v);
  if (mb) {
    const b = S.content.sections[+mb[1]]?.blocks[+mb[2]];
    if (b) S.open.add(b);
    select('s:' + mb[1], { block: +mb[2], fromPreview: true });
  } else select(v, { fromPreview: true });
  if (matchMedia('(max-width:1180px)').matches) togglePreview(false);
}
function layoutPreview() {
  const stage = $('#stage'), sc = $('#scale');
  const W = stage.clientWidth - 28, H = stage.clientHeight - 28;
  if (W <= 0 || H <= 0) return;
  const k = Math.min(1, W / pvW);
  sc.style.width = pvW + 'px';
  sc.style.height = Math.round(H / k) + 'px';
  sc.style.transform = `translateX(-50%) scale(${k})`;
  document.querySelectorAll('#devices button').forEach(b => b.classList.toggle('on', +b.dataset.w === pvW));
}
function togglePreview(open) {
  $('#preview').classList.toggle('open', open);
  if (open) requestAnimationFrame(layoutPreview);
}

/* ───────── навигация ───────── */
function select(key, o = {}) {
  S.sel = key;
  renderSide();
  renderEditor();
  if (!o.fromPreview) scrollPreview(key);
  if (o.block != null) {
    const el = document.getElementById(`blk-${key.slice(2)}-${o.block}`);
    if (el) { el.scrollIntoView({ block: 'start' }); el.classList.add('flash'); }
  } else if (!o.keep) $('#editor').scrollTop = 0;
  $('#side').classList.remove('open');
}
function updateStatus() {
  const st = $('#status'), d = isDirty(), demo = S.mode !== 'github';
  st.className = 'status ' + (demo ? '' : d ? 'dirty' : 'ok');
  st.textContent = demo ? 'Режим просмотра — без входа опубликовать нельзя' : d ? 'Есть неопубликованные изменения' : 'Всё опубликовано';
  const pb = $('#publishBtn');
  pb.textContent = demo ? 'Войти' : 'Опубликовать';
  pb.disabled = !demo && !d;
  $('#undoBtn').disabled = !S.undo.length;
  $('#redoBtn').disabled = !S.redo.length;
}

/* ───────── вход и запуск ───────── */
function guessRepo() {
  const m = /^([^.]+)\.github\.io$/i.exec(location.hostname);
  if (!m) return '';
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return m[1] + '/' + (seg && seg !== 'admin' ? seg : m[1] + '.github.io');
}
function showLogin(err, mode = S.vault ? 'unlock' : 'setup') {
  $('#app').hidden = true; $('#login').hidden = false;
  const logo = (S.content || S.siteContent)?.brand?.logo;
  if (logo) { $('.login__logo').src = ROOT + logo; $('.login__logo').hidden = false; }
  $('#unlockForm').hidden = mode !== 'unlock';
  $('#setupForm').hidden = mode !== 'setup';
  const f = $('#setupForm');
  if (!f.repo.value) f.repo.value = S.auth?.repo || S.hint?.repo || S.siteContent?.admin?.repo || guessRepo();
  f.branch.value = S.auth?.branch || S.hint?.branch || S.siteContent?.admin?.branch || f.branch.value || 'main';
  $('#setupIntro').textContent = S.vault
    ? 'Восстановление доступа. Вставьте ключ GitHub (можно выпустить новый — инструкция ниже) и придумайте пароль: старый перестанет работать.'
    : 'Первая настройка, один раз. Чтобы админка могла сохранять изменения на GitHub, нужен «ключ доступа» — его выпускают на GitHub за пару минут (инструкция ниже). Админка спрячет ключ за паролем, который вы придумаете. Дальше вход — только по паролю, с любого устройства.';
  for (const id of ['#unlockErr', '#setupErr']) { $(id).hidden = true; $(id).textContent = ''; }
  const er = $(mode === 'unlock' ? '#unlockErr' : '#setupErr');
  if (err) { er.textContent = err; er.hidden = false; }
  $('#toSetup').hidden = !(S.vault && mode === 'unlock');
  $('#toUnlock').hidden = !(S.vault && mode === 'setup');
  $('#demoBtn').textContent = S.content ? 'Вернуться к редактированию' : 'Посмотреть без входа';
  (mode === 'unlock' ? $('#unlockForm').password : f.repo.value ? f.token : f.repo).focus();
}
async function loadGithub() {
  const carry = S.mode === 'demo' && isDirty() ? S.content : null;
  const [{ json, sha }, head] = await Promise.all([loadRemote(), headSha()]);
  S.mode = 'github';
  S.baseSha = sha; S.headSha = head;
  S.content = normalize(JSON.parse(json));
  S.baseJson = JSON.stringify(S.content);
  if (carry) { S.content = carry; toast('Правки, сделанные без входа, перенесены — их можно опубликовать.'); }
  else await maybeRestoreDraft();
}
async function startGithub() { await loadGithub(); openApp(); }
// Вход с расшифрованным ключом. Если GitHub ключ не принял (кончился срок) — отправляем на экран настройки.
async function enter(auth, key, remember) {
  S.auth = auth;
  try { await startGithub(); }
  catch (e) {
    if (e.status === 401) return showLogin('Ключ доступа к GitHub больше не действует — скорее всего, закончился его срок. Выпустите новый ключ (инструкция ниже) и вставьте сюда: пароль можно оставить прежним.', 'setup');
    throw e;
  }
  if (remember) keyStore.put('vaultKey', { key, salt: S.vault.salt }); else keyStore.clear();
}
async function startDemo() {
  if (S.content) return openApp();
  const r = await fetch(ROOT + 'content.json', { cache: 'no-store' });
  if (!r.ok) throw new Error('Не нашёл файл content.json рядом с сайтом.');
  S.mode = 'demo';
  S.content = normalize(await r.json());
  S.baseJson = JSON.stringify(S.content);
  await maybeRestoreDraft();
  openApp();
}
function openApp() {
  $('#login').hidden = true; $('#app').hidden = false;
  renderSide(); renderEditor(); updateStatus(); updatePreview(); layoutPreview();
}
function init() {
  $('#unlockForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, btn = $('#unlockBtn'), err = $('#unlockErr');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Проверяю…';
    try {
      let key, auth;
      try { key = await vaultKey(S.vault, f.password.value); auth = await openVault(S.vault, key); }
      catch { throw new Error('Неверный пароль. Проверьте раскладку клавиатуры и Caps Lock.'); }
      f.password.value = '';
      await enter(auth, key, f.remember.checked);
    } catch (x) { err.textContent = x.message; err.hidden = false; }
    finally { btn.disabled = false; btn.textContent = 'Войти'; }
  });
  $('#setupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, btn = $('#setupBtn'), err = $('#setupErr');
    err.hidden = true; btn.disabled = true; btn.textContent = 'Проверяю…';
    try {
      const repo = f.repo.value.trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
      if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Репозиторий пишется так: имя-аккаунта/название-репозитория');
      const pw = f.password.value;
      if (pw !== f.password2.value) throw new Error('Пароли не совпадают.');
      const weak = weakPassword(pw);
      if (weak) throw new Error(weak);
      S.auth = { repo, branch: f.branch.value.trim() || 'main', token: f.token.value.trim() };
      await gh(rp());                                      // ключ и репозиторий подходят?
      btn.textContent = 'Защищаю ключ паролем…';
      const { vault, key } = await sealVault(S.auth, pw);
      await loadGithub();
      btn.textContent = 'Сохраняю…';
      await saveVault(vault, 'Админка: вход по паролю');
      if (f.remember.checked) keyStore.put('vaultKey', { key, salt: vault.salt }); else keyStore.clear();
      f.token.value = f.password.value = f.password2.value = '';
      openApp();
      toast('Готово. С другого устройства заходите на /admin/ и вводите только пароль — через минуту-две, когда сайт обновится.');
    } catch (x) { err.textContent = x.message; err.hidden = false; }
    finally { btn.disabled = false; btn.textContent = 'Настроить и войти'; }
  });
  const hint = $('#pwHint'), hintText = hint.textContent;
  $('#setupForm').password.addEventListener('input', e => {
    const w = e.target.value ? weakPassword(e.target.value) : '';
    hint.textContent = !e.target.value ? hintText : w || 'Надёжный пароль ✓';
    hint.className = 'pwhint' + (!e.target.value ? '' : w ? ' bad' : ' ok');
  });
  $('#genPw').addEventListener('click', () => {
    const f = $('#setupForm'), pw = genPassword();
    f.password.value = f.password2.value = pw; f.password.type = f.password2.type = 'text';
    hint.className = 'pwhint ok';
    hint.textContent = 'Запишите этот пароль или дайте браузеру его сохранить — он нужен для входа. Забудете — не страшно: задать новый можно с ключом GitHub.';
  });
  $('#toSetup').addEventListener('click', () => showLogin('', 'setup'));
  $('#toUnlock').addEventListener('click', () => showLogin('', 'unlock'));
  $('#demoBtn').addEventListener('click', () => startDemo().catch(x => {
    const er = $('#unlockForm').hidden ? $('#setupErr') : $('#unlockErr'); er.textContent = x.message; er.hidden = false;
  }));
  $('#publishBtn').addEventListener('click', publish);
  $('#undoBtn').addEventListener('click', undo);
  $('#redoBtn').addEventListener('click', redo);
  $('#navToggle').addEventListener('click', () => $('#side').classList.toggle('open'));
  $('#previewToggle').addEventListener('click', () => togglePreview(!$('#preview').classList.contains('open')));
  $('#previewClose').addEventListener('click', () => togglePreview(false));
  $('#devices').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    pvW = +b.dataset.w; localStorage.setItem(LS_DEV, pvW); layoutPreview();
  });
  new ResizeObserver(layoutPreview).observe($('#stage'));
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyS') { e.preventDefault(); if (S.content) publish(); }
    else if (mod && !typing && e.code === 'KeyZ') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && !typing && e.code === 'KeyY') { e.preventDefault(); redo(); }
  });
}
async function boot() {
  init();
  localStorage.removeItem(LS_OLD_AUTH);
  try { S.siteContent = await (await fetch(ROOT + 'content.json', { cache: 'no-store' })).json(); } catch {}
  S.vault = await fetchVault();
  const rk = S.vault && await keyStore.get('vaultKey');       // «запомненный» ключ входа
  if (rk && rk.salt === S.vault.salt) {
    let auth = null;
    try { auth = await openVault(S.vault, rk.key); } catch { keyStore.clear(); }
    if (auth) { try { await enter(auth, rk.key, true); } catch (e) { showLogin(e.message); } return; }
  }
  showLogin();
}
boot();
