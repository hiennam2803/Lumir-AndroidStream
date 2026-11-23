/* LUMIR · Game Key Mapping — lõi thuần (không DOM, không Tauri) nên test được bằng Node.
   Gồm: schema JSON + chuẩn hoá/kiểm tra, quản lý profile, xung đột phím, và Engine biến phím máy tính thành nhiều ngón chạm.
   Không dùng chung gì với Chat Keyboard (phone.js: setKbd/kbSend...). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LumirKeymapCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const SCHEMA = 'lumir.keymap', PROFILE_SCHEMA = 'lumir.keymap.profile', VERSION = 1;
const LIM = { name: 60, ctlName: 24, controls: 60, profiles: 100, minSize: 0.04, maxSize: 0.6, game: 80 };
const DIRS = ['up', 'left', 'down', 'right'];
const DEFAULT_JOY_KEYS = { up: 'KeyW', left: 'KeyA', down: 'KeyS', right: 'KeyD' };
const TYPES = ['joystick', 'dpad', 'button'];
/* F3 / F11 là phím của cửa sổ (ẩn thanh công cụ / toàn màn hình), Escape huỷ thao tác gán phím, phím Windows thuộc về hệ điều hành. */
const RESERVED = ['F3', 'F11', 'Escape', 'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight'];
/* Điện thoại có tối đa 10 ngón; 1 ngón dành cho chuột → ánh xạ phím dùng tối đa 9 ngón cùng lúc. */
const MAX_POINTERS = 9;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const str = (v, max, d = '') => (typeof v === 'string' ? v.trim().slice(0, max) : d);
const uid = p => p + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const clone = o => JSON.parse(JSON.stringify(o));

/* ───────────── Phím ───────────── */
const KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,23}$/;
const validCode = c => typeof c === 'string' && KEY_RE.test(c);
const assignable = c => validCode(c) && !RESERVED.includes(c);

const LABELS = {
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Num Enter', Backspace: 'Backspace', Tab: 'Tab', CapsLock: 'Caps',
  ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
  Backquote: '`', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', IntlBackslash: '\\',
  NumpadAdd: 'Num +', NumpadSubtract: 'Num -', NumpadMultiply: 'Num *', NumpadDivide: 'Num /', NumpadDecimal: 'Num .',
  PageUp: 'PgUp', PageDown: 'PgDn', Delete: 'Del', Insert: 'Ins', Home: 'Home', End: 'End', ContextMenu: 'Menu'
};
function keyLabel(code) {
  if (!code) return '';
  if (LABELS[code]) return LABELS[code];
  let m = /^Key([A-Z])$/.exec(code); if (m) return m[1];
  m = /^Digit(\d)$/.exec(code); if (m) return m[1];
  m = /^Numpad(\d)$/.exec(code); if (m) return 'Num ' + m[1];
  return code;
}

/* ───────────── Control ───────────── */
/* Toạ độ chuẩn hoá 0..1 trên khung hình điện thoại; kích thước = đường kính / cạnh NGẮN của khung (nên nút luôn tròn,
   và không đổi khi đổi độ phân giải hay kích thước cửa sổ). */
const SIZE_DEFAULT = { joystick: 0.34, dpad: 0.1, button: 0.1 };

/* Đổi "đơn vị = cạnh ngắn" sang khoảng cách chuẩn hoá theo từng trục; aspect = rộng/cao của khung. */
function unitAxes(aspect) {
  const a = aspect > 0 ? aspect : 0.45;
  return a < 1 ? { ux: 1, uy: a } : { ux: 1 / a, uy: 1 };
}

function makeControl(type, o = {}) {
  const id = o.id || uid('c');
  const x = clamp(num(o.x, 0.5), 0, 1), y = clamp(num(o.y, 0.5), 0, 1);
  const { ux, uy } = unitAxes(o.aspect);
  if (type === 'joystick') {
    return { id, type, name: str(o.name, LIM.ctlName, 'Move'), x, y, size: clamp(num(o.size, SIZE_DEFAULT.joystick), LIM.minSize, LIM.maxSize), keys: { ...DEFAULT_JOY_KEYS, ...(o.keys || {}) } };
  }
  if (type === 'dpad') {
    const s = clamp(num(o.size, SIZE_DEFAULT.dpad), LIM.minSize, LIM.maxSize), d = s * 1.05;   /* khoảng cách tâm → nút = một nút + một chút hở */
    const at = (dx, dy) => ({ x: clamp(x + dx * d * ux, 0, 1), y: clamp(y + dy * d * uy, 0, 1), size: s });
    const k = { ...DEFAULT_JOY_KEYS, ...(o.keys || {}) };
    return { id, type, name: str(o.name, LIM.ctlName, 'D-pad'), buttons: {
      up: { key: k.up, ...at(0, -1) }, left: { key: k.left, ...at(-1, 0) }, down: { key: k.down, ...at(0, 1) }, right: { key: k.right, ...at(1, 0) } } };
  }
  return { id, type: 'button', name: str(o.name, LIM.ctlName, 'Button'), key: o.key || '', x, y, size: clamp(num(o.size, SIZE_DEFAULT.button), LIM.minSize, LIM.maxSize) };
}

/* Mọi ô gán phím của một control: [{slot, get(), set(code)}]. slot '' cho nút đơn. */
function keySlots(c) {
  if (c.type === 'joystick') return DIRS.map(s => ({ slot: s, get: () => c.keys[s], set: v => { c.keys[s] = v; } }));
  if (c.type === 'dpad') return DIRS.map(s => ({ slot: s, get: () => c.buttons[s].key, set: v => { c.buttons[s].key = v; } }));
  return [{ slot: '', get: () => c.key, set: v => { c.key = v; } }];
}

/* Phím → các control dùng nó trong một profile. */
function keyOwners(profile) {
  const m = new Map();
  for (const c of profile.controls) for (const s of keySlots(c)) { const k = s.get(); if (k) { if (!m.has(k)) m.set(k, []); m.get(k).push({ c, slot: s.slot }); } }
  return m;
}

/* Gán phím cho (control, slot). Mỗi phím chỉ thuộc MỘT ô trong một profile (nếu không, một lần nhấn sẽ làm hai việc).
   Trả { ok:true } hoặc { ok:false, reason:'reserved'|'invalid'|'used', by:{control, slot} }. code '' = bỏ gán. */
function assignKey(profile, controlId, slot, code) {
  const c = profile.controls.find(x => x.id === controlId);
  if (!c) return { ok: false, reason: 'invalid' };
  const s = keySlots(c).find(x => x.slot === slot);
  if (!s) return { ok: false, reason: 'invalid' };
  if (code === '') { s.set(''); return { ok: true }; }
  if (!validCode(code)) return { ok: false, reason: 'invalid' };
  if (RESERVED.includes(code)) return { ok: false, reason: 'reserved' };
  const hit = (keyOwners(profile).get(code) || []).find(o => !(o.c.id === controlId && o.slot === slot));
  if (hit) return { ok: false, reason: 'used', by: { control: hit.c, slot: hit.slot } };
  s.set(code);
  return { ok: true };
}

/* ───────────── Chuẩn hoá (đọc file/JSON import không tin cậy) ───────────── */
function normControl(r, usedIds) {
  if (!r || typeof r !== 'object' || !TYPES.includes(r.type)) return null;
  let id = str(r.id, 40);
  if (!id || usedIds.has(id)) id = uid('c');
  usedIds.add(id);
  const name = str(r.name, LIM.ctlName);
  const keyOf = v => (validCode(v) ? v : '');
  const pos = o => ({ x: clamp(num(o && o.x, 0.5), 0, 1), y: clamp(num(o && o.y, 0.5), 0, 1), size: clamp(num(o && o.size, SIZE_DEFAULT[r.type]), LIM.minSize, LIM.maxSize) });
  if (r.type === 'joystick') {
    const k = r.keys && typeof r.keys === 'object' ? r.keys : DEFAULT_JOY_KEYS;
    const keys = {}; DIRS.forEach(d => { keys[d] = keyOf(k[d]); });
    return { id, type: 'joystick', name: name || 'Move', ...pos(r), keys };
  }
  if (r.type === 'dpad') {
    const bs = r.buttons && typeof r.buttons === 'object' ? r.buttons : {}, buttons = {};
    const fb = makeControl('dpad').buttons;
    DIRS.forEach(d => { const b = bs[d] && typeof bs[d] === 'object' ? bs[d] : fb[d]; buttons[d] = { key: keyOf(b.key), ...pos(b) }; });
    return { id, type: 'dpad', name: name || 'D-pad', buttons };
  }
  return { id, type: 'button', name: name || 'Button', key: keyOf(r.key), ...pos(r) };
}

/* Mỗi phím chỉ một ô: ô trùng/phím bị cấm (đọc từ file sửa tay) bị bỏ gán chứ không làm hỏng cả profile. */
function dedupeKeys(profile) {
  const seen = new Set();
  for (const c of profile.controls) for (const s of keySlots(c)) {
    const k = s.get();
    if (k && (RESERVED.includes(k) || seen.has(k))) s.set(''); else if (k) seen.add(k);
  }
}

function normPlatform(r) {
  const p = r && typeof r === 'object' ? r : {};
  return { os: 'android', device: str(p.device, 80), resolution: str(p.resolution, 24), orientation: p.orientation === 'landscape' ? 'landscape' : 'portrait' };
}

function normProfile(r, usedIds) {
  if (!r || typeof r !== 'object') return null;
  let id = str(r.id, 40);
  if (!id || usedIds.has(id)) id = uid('p');
  usedIds.add(id);
  const cIds = new Set(), controls = [];
  for (const c of Array.isArray(r.controls) ? r.controls : []) {
    if (controls.length >= LIM.controls) break;
    const n = normControl(c, cIds); if (n) controls.push(n);
  }
  const g = r.game && typeof r.game === 'object' ? r.game : null;
  const pkg = g ? str(g.package, 120) : '', label = g ? str(g.label, LIM.game) : '';
  const now = Date.now();
  const p = {
    id, name: str(r.name, LIM.name) || 'Profile', platform: normPlatform(r.platform),
    game: pkg || label ? { package: /^[A-Za-z][\w]*(\.[\w]+)+$/.test(pkg) ? pkg : '', label } : null,
    createdAt: num(r.createdAt, now), updatedAt: num(r.updatedAt, now), lastUsedAt: num(r.lastUsedAt, 0), controls
  };
  dedupeKeys(p);
  return p;
}

function defaultProfile(name, platform) {
  const now = Date.now();
  return { id: uid('p'), name: str(name, LIM.name) || 'Profile 1', platform: normPlatform(platform), game: null, createdAt: now, updatedAt: now, lastUsedAt: 0, controls: [] };
}
function defaultStore() {
  const p = defaultProfile('Profile 1');
  return { schema: SCHEMA, version: VERSION, activeProfileId: p.id, settings: { hints: true, autoSelect: true, panel: null }, profiles: [p] };
}

/* Nhận object đã parse; ném Error nếu không phải file Game Key Mapping của LUMIR. Luôn trả store hợp lệ (≥1 profile). */
function normStore(raw) {
  if (!raw || typeof raw !== 'object' || raw.schema !== SCHEMA) throw new Error('Not a LUMIR key mapping file');
  const used = new Set(), profiles = [];
  for (const p of Array.isArray(raw.profiles) ? raw.profiles : []) {
    if (profiles.length >= LIM.profiles) break;
    const n = normProfile(p, used); if (n) profiles.push(n);
  }
  if (!profiles.length) profiles.push(defaultProfile('Profile 1'));
  const s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const pn = s.panel && typeof s.panel === 'object' ? { x: clamp(num(s.panel.x, 0.7), 0, 1), y: clamp(num(s.panel.y, 0.1), 0, 1) } : null;
  return {
    schema: SCHEMA, version: VERSION,
    activeProfileId: profiles.some(p => p.id === raw.activeProfileId) ? raw.activeProfileId : profiles[0].id,
    settings: { hints: s.hints !== false, autoSelect: s.autoSelect !== false, panel: pn },
    profiles
  };
}
function parseStore(text) {
  if (!text || !String(text).trim()) return defaultStore();
  return normStore(JSON.parse(text));
}
const serialize = s => JSON.stringify(s, null, 2);
/* So sánh "đã sửa chưa": bỏ vị trí bảng công cụ (kéo bảng không phải là sửa cấu hình) và mốc thời gian. */
const FP_SKIP = { panel: 1, updatedAt: 1, lastUsedAt: 1 };
function fingerprint(s) {
  /* Không clone cả store (được gọi rất nhiều lần khi kéo/đổi cỡ): để JSON.stringify bỏ thẳng các khoá không tính là "đã sửa". */
  return JSON.stringify(s, (k, v) => (FP_SKIP[k] === 1 ? undefined : v));
}

/* ───────────── Profile ───────────── */
const activeProfile = s => s.profiles.find(p => p.id === s.activeProfileId) || s.profiles[0];

function uniqueName(store, base, exceptId) {
  const names = new Set(store.profiles.filter(p => p.id !== exceptId).map(p => p.name.toLowerCase()));
  base = str(base, LIM.name) || 'Profile';
  if (!names.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n++) { const t = `${base} (${n})`.slice(0, LIM.name + 6); if (!names.has(t.toLowerCase())) return t; }
  return base;
}
function addProfile(store, name, platform) {
  if (store.profiles.length >= LIM.profiles) throw new Error('Too many profiles');
  const p = defaultProfile(uniqueName(store, name || 'Profile ' + (store.profiles.length + 1)), platform);
  store.profiles.push(p); store.activeProfileId = p.id; return p;
}
function renameProfile(store, id, name) {
  const p = store.profiles.find(x => x.id === id); if (!p) return null;
  const n = str(name, LIM.name); if (!n) return p;
  p.name = n; p.updatedAt = Date.now(); return p;
}
function duplicateProfile(store, id) {
  const src = store.profiles.find(x => x.id === id); if (!src) return null;
  if (store.profiles.length >= LIM.profiles) throw new Error('Too many profiles');
  const p = clone(src), now = Date.now();
  p.id = uid('p'); p.name = uniqueName(store, src.name + ' copy'); p.createdAt = p.updatedAt = now; p.lastUsedAt = 0;
  const ids = new Set(); p.controls.forEach(c => { c.id = uid('c'); ids.add(c.id); });
  store.profiles.splice(store.profiles.indexOf(src) + 1, 0, p); store.activeProfileId = p.id; return p;
}
/* Xoá profile; xoá hết thì tạo lại một profile trống để luôn có cái để dùng. */
function deleteProfile(store, id) {
  const i = store.profiles.findIndex(x => x.id === id); if (i < 0) return;
  store.profiles.splice(i, 1);
  if (!store.profiles.length) { const p = defaultProfile('Profile 1'); store.profiles.push(p); }
  if (!store.profiles.some(p => p.id === store.activeProfileId)) store.activeProfileId = store.profiles[Math.min(i, store.profiles.length - 1)].id;
}

/* Profile gắn với một game (theo tên gói), mới dùng gần nhất lên đầu. */
function profilesForGame(store, pkg) {
  if (!pkg) return [];
  return store.profiles.filter(p => p.game && p.game.package === pkg).sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0));
}

/* ───────────── Import / Export ───────────── */
function exportProfile(profile) { return JSON.stringify({ schema: PROFILE_SCHEMA, version: VERSION, profile }, null, 2); }
function exportAll(store) { return serialize(store); }
/* Nhận file đã export (1 profile hoặc cả bộ) → danh sách profile hợp lệ với id MỚI (không đè profile đang có). */
function parseImport(text) {
  let raw; try { raw = JSON.parse(text); } catch (_) { throw new Error('Invalid JSON file'); }
  if (!raw || typeof raw !== 'object') throw new Error('Not a LUMIR key mapping file');
  let list;
  if (raw.schema === PROFILE_SCHEMA && raw.profile) list = [raw.profile];
  else if (raw.schema === SCHEMA && Array.isArray(raw.profiles)) list = raw.profiles;
  else throw new Error('Not a LUMIR key mapping file');
  const out = [];
  for (const r of list.slice(0, LIM.profiles)) {
    const n = normProfile(r, new Set()); if (!n) continue;
    n.id = uid('p'); n.controls.forEach(c => { c.id = uid('c'); }); out.push(n);
  }
  if (!out.length) throw new Error('No profiles found in this file');
  return out;
}
function importProfiles(store, profiles) {
  let n = 0;
  for (const p of profiles) {
    if (store.profiles.length >= LIM.profiles) break;
    p.name = uniqueName(store, p.name); store.profiles.push(p); n++;
  }
  if (n) store.activeProfileId = store.profiles[store.profiles.length - 1].id;
  return n;
}

/* ───────────── Engine: phím máy tính → nhiều ngón chạm ─────────────
   Giao tiếp ra ngoài chỉ qua send(pointer, 'down'|'move'|'up', x, y) với toạ độ chuẩn hoá (cùng hệ với touch_pointer của Rust).
   Mỗi ngón lấy id từ một bể 0..8 lúc nhấn và trả lại lúc nhả → tối đa 9 ngón cùng lúc, hết bể thì bỏ qua lần nhấn đó (không phá ngón khác).
   - Nút / nút của D-pad: nhấn = chạm xuống tại vị trí nút, giữ = giữ, thả = nhấc. Hai nút cùng lúc = hai ngón (đi chéo).
   - Joystick tròn: chạm xuống ở tâm rồi trượt mượt tới hướng đang giữ (8 hướng, chéo chuẩn hoá để không nhanh hơn √2 lần);
     đổi hướng thì ngón trượt liên tục sang hướng mới; nhả hết phím thì nhấc ngón.
   - Giữ tối thiểu MIN_HOLD ms cho mỗi lần chạm để cú gõ cực nhanh vẫn được game ghi nhận. */
const MIN_HOLD = 45, TAU = 32, SNAP = 0.015;

function joyVector(held) {
  let x = 0, y = 0;
  if (held.has('left')) x -= 1; if (held.has('right')) x += 1;
  if (held.has('up')) y -= 1; if (held.has('down')) y += 1;
  if (x && y) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
  return { x, y };
}

class Engine {
  /* opts: send(pointer, phase, x, y) · geom() → {w,h} px của khung hiển thị · now() · onExhausted() */
  constructor(o) {
    this.send = o.send; this.geom = o.geom; this.now = o.now || (() => performance.now()); this.onExhausted = o.onExhausted || (() => {});
    this.profile = null; this.index = new Map(); this.down = new Set();
    this.btns = new Map();   /* 'controlId:slot' → {id, slot, pointer, x, y, downAt, releaseAt} */
    this.joys = new Map();   /* controlId → {c, held:Set, pointer, cur, vis, pos, downAt, releaseAt} */
    this.free = Array.from({ length: MAX_POINTERS }, (_, i) => i);
    this.last = null; this.warned = false;
  }
  _alloc() { return this.free.length ? this.free.shift() : null; }
  _free(p) { if (!this.free.includes(p)) { this.free.push(p); this.free.sort((a, b) => a - b); } }

  setProfile(p) {
    this.releaseAll();
    this.profile = p; this.index = new Map(); this.joys = new Map();
    if (!p) return;
    for (const c of p.controls) {
      for (const s of keySlots(c)) { const k = s.get(); if (!k) continue; if (!this.index.has(k)) this.index.set(k, []); this.index.get(k).push({ c, slot: s.slot }); }
      if (c.type === 'joystick') this.joys.set(c.id, { c, held: new Set(), latch: { x: 0, y: 0 }, pointer: null, cur: { x: 0, y: 0 }, vis: { x: 0, y: 0 }, pos: null, downAt: 0, releaseAt: null });
    }
  }
  has(code) { return this.index.has(code); }
  get activeCount() { return MAX_POINTERS - this.free.length; }

  keyDown(code) {
    const owners = this.index.get(code);
    if (!owners) return false;
    const t = this.now();
    if (this.down.has(code)) {                 /* tự lặp phím của hệ điều hành: không nhấn lại, nhưng nút nào lúc nhấn bị bỏ vì hết ngón thì thử lại */
      for (const { c, slot } of owners) if (c.type !== 'joystick' && !this.btns.has(c.id + ':' + slot)) this._btnDown(c, slot, t);
      return true;
    }
    this.down.add(code);
    for (const { c, slot } of owners) {
      if (c.type === 'joystick') { const j = this.joys.get(c.id); j.held.add(slot); j.releaseAt = null; j.latch = joyVector(j.held); this._joyEnsure(j, t); }
      else this._btnDown(c, slot, t);
    }
    return true;
  }
  keyUp(code) {
    const owners = this.index.get(code);
    if (!owners || !this.down.has(code)) return !!owners;
    this.down.delete(code);
    const t = this.now();
    for (const { c, slot } of owners) {
      if (c.type === 'joystick') {
        const j = this.joys.get(c.id); const before = joyVector(j.held); j.held.delete(slot);
        if (j.held.size) j.latch = joyVector(j.held); else if (before.x || before.y) j.latch = before;
        if (!j.held.size && j.pointer != null) j.releaseAt = Math.max(t, j.downAt + MIN_HOLD);
      } else {
        const b = this.btns.get(c.id + ':' + slot);
        if (b && b.pointer != null) b.releaseAt = Math.max(t, b.downAt + MIN_HOLD);
      }
    }
    this.update(t);   /* thả ngay nếu đã đủ thời gian giữ tối thiểu */
    return true;
  }

  _btnDown(c, slot, t) {
    const key = c.id + ':' + slot;
    const old = this.btns.get(key);
    if (old && old.pointer != null) this._btnUp(key);   /* nhấn lại khi lần nhả trước còn chờ: nhả hẳn rồi chạm mới */
    const p = this._alloc();
    if (p == null) { this._exhausted(); return; }
    const src = c.type === 'dpad' ? c.buttons[slot] : c;
    this.btns.set(key, { id: c.id, slot, pointer: p, x: src.x, y: src.y, downAt: t, releaseAt: null });
    this.send(p, 'down', src.x, src.y);
  }
  _btnUp(key) {
    const b = this.btns.get(key); if (!b) return;
    this.btns.delete(key);
    if (b.pointer != null) { this.send(b.pointer, 'up', b.x, b.y); this._free(b.pointer); }
  }
  _exhausted() { if (!this.warned) { this.warned = true; this.onExhausted(); setTimeout(() => { this.warned = false; }, 2000); } }

  _joyEnsure(j, t) {
    if (j.pointer != null) return;
    const p = this._alloc();
    if (p == null) { this._exhausted(); return; }
    j.pointer = p; j.downAt = t; j.cur = { x: 0, y: 0 }; j.pos = { x: j.c.x, y: j.c.y };
    this.send(p, 'down', j.c.x, j.c.y);
  }
  _joyUp(j) {
    if (j.pointer == null) return;
    this.send(j.pointer, 'up', j.pos.x, j.pos.y); this._free(j.pointer);
    j.pointer = null; j.releaseAt = null; j.cur = { x: 0, y: 0 }; j.latch = { x: 0, y: 0 };
  }

  /* Gọi mỗi khung hình (rAF) + một bộ đếm dự phòng: làm trượt joystick, thực hiện các lần nhả đang chờ MIN_HOLD. */
  /* Rảnh = không ngón nào đang chạm, không phím joystick nào đang giữ và núm hiển thị đã về tâm → update() không có gì để làm. */
  get idle() {
    if (this.btns.size) return false;
    for (const j of this.joys.values()) if (j.pointer != null || j.held.size || j.vis.x || j.vis.y) return false;
    return true;
  }
  update(t = this.now()) {
    if (this.idle) { this.last = null; return; }   /* khung đầu sau khi rảnh dùng dt mặc định 16ms như trước */
    const dt = this.last == null ? 16 : clamp(t - this.last, 0, 100);
    this.last = t;
    for (const [k, b] of this.btns) if (b.releaseAt != null && t >= b.releaseAt) this._btnUp(k);   /* xoá phần tử đang duyệt trong Map là an toàn */
    const g = this.geom() || {}, w = g.w > 0 ? g.w : 0, h = g.h > 0 ? g.h : 0;
    const f = 1 - Math.exp(-dt / TAU);
    for (const j of this.joys.values()) {
      if (j.pointer == null && j.held.size) this._joyEnsure(j, t);   /* hết bể ngón lúc nhấn → thử lại */
      if (j.pointer != null) {
        if (j.releaseAt != null && t >= j.releaseAt) { this._joyUp(j); }
        else {
          /* Đang chờ nhả (gõ rất nhanh): vẫn trượt về hướng vừa giữ, để cú gõ ngắn cũng làm nhân vật nhích một bước. */
          const tg = j.held.size ? joyVector(j.held) : j.latch;
          j.cur.x += (tg.x - j.cur.x) * f; j.cur.y += (tg.y - j.cur.y) * f;
          if (Math.abs(tg.x - j.cur.x) < SNAP) j.cur.x = tg.x;
          if (Math.abs(tg.y - j.cur.y) < SNAP) j.cur.y = tg.y;
          if (w && h) {
            const R = j.c.size * Math.min(w, h) / 2;   /* bán kính vòng joystick (px) */
            const nx = clamp(j.c.x + j.cur.x * R / w, 0, 1), ny = clamp(j.c.y + j.cur.y * R / h, 0, 1);
            if (Math.abs(nx - j.pos.x) > 1e-4 || Math.abs(ny - j.pos.y) > 1e-4) { j.pos = { x: nx, y: ny }; this.send(j.pointer, 'move', nx, ny); }
          }
        }
      }
      /* Núm hiển thị bám theo ngón; nhả rồi thì trượt về tâm cho đẹp (không liên quan tới cảm ứng thật). */
      if (j.pointer != null) j.vis = { x: j.cur.x, y: j.cur.y };
      else { j.vis.x += (0 - j.vis.x) * f; j.vis.y += (0 - j.vis.y) * f; if (Math.abs(j.vis.x) < 0.005 && Math.abs(j.vis.y) < 0.005) j.vis = { x: 0, y: 0 }; }
    }
  }

  /* Nhấc mọi ngón NGAY (thoát chế độ chơi, mất focus, đổi profile...). */
  releaseAll() {
    for (const k of [...this.btns.keys()]) this._btnUp(k);
    for (const j of this.joys.values()) { j.held.clear(); this._joyUp(j); j.vis = { x: 0, y: 0 }; }
    this.down.clear();
  }
  /* Quên hết trạng thái mà không gửi gì (kênh điều khiển đã hỏng, gửi thêm cũng vô ích). */
  reset() {
    this.btns.clear(); for (const j of this.joys.values()) { j.held.clear(); j.pointer = null; j.releaseAt = null; j.cur = { x: 0, y: 0 }; j.vis = { x: 0, y: 0 }; }
    this.down.clear(); this.free = Array.from({ length: MAX_POINTERS }, (_, i) => i);
  }
  /* Cho giao diện: nút nào đang nhấn + vị trí núm joystick. */
  view() {
    const pressed = new Set(); for (const [k, b] of this.btns) if (b.pointer != null) pressed.add(k);
    const joy = new Map(); for (const [id, j] of this.joys) joy.set(id, { x: j.vis.x, y: j.vis.y, on: j.pointer != null });
    return { pressed, joy };
  }
}

return {
  SCHEMA, PROFILE_SCHEMA, VERSION, LIM, DIRS, TYPES, RESERVED, MAX_POINTERS, DEFAULT_JOY_KEYS, MIN_HOLD,
  clamp, clone, uid, validCode, assignable, keyLabel, unitAxes,
  makeControl, keySlots, keyOwners, assignKey,
  normStore, parseStore, serialize, fingerprint, defaultStore, defaultProfile,
  activeProfile, uniqueName, addProfile, renameProfile, duplicateProfile, deleteProfile, profilesForGame,
  exportProfile, exportAll, parseImport, importProfiles,
  joyVector, Engine
};
});