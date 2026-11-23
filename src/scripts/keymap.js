/* LUMIR · Game Key Mapping — giao diện chỉnh sửa, chế độ chơi, profile, lưu JSON.
   Nạp SAU phone.js và keymap-core.js; nối với phone.js qua window.LumirKeymap (on/editing/toggle/set/key).
   Độc lập với Chat Keyboard: không dùng setKbd/kbSend/ô nhập ẩn của nó; chỉ gửi chạm qua `touch_pointer` (đa điểm, id ngón 100+),
   có state, sự kiện và hàng đợi riêng. Lưu ở keymap.json do Rust quản lý (xem keymap.rs). */
(() => {
'use strict';
const P = window.LumirPhone, C = window.LumirKeymapCore;
if (!P || !C) return;
const { call, toast, T, VI, $, cv, demo } = P;
const TA = window.__TAURI__;
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

Object.assign(VI, {
 'Hide controls': 'Ẩn các nút trên màn hình', 'Show controls': 'Hiện các nút trên màn hình',
 'Game Key Mapping': 'Ánh xạ phím game', 'Chat keyboard': 'Bàn phím nhắn tin',
 'Profile': 'Profile', 'Profile name': 'Tên profile', 'Game': 'Game', 'Game name': 'Tên game', 'Add controls': 'Thêm điều khiển', 'Controls': 'Điều khiển', 'Options': 'Tuỳ chọn',
 'Circular Joystick': 'Joystick tròn', 'Directional Joystick': 'Joystick 4 nút', 'Custom Button': 'Nút tuỳ chỉnh',
 'Joystick': 'Joystick', 'D-pad': 'D-pad', 'Button': 'Nút', 'Move': 'Di chuyển',
 'Save': 'Lưu', 'Done': 'Xong', 'Cancel': 'Huỷ', 'Saved': 'Đã lưu', 'Discard changes?': 'Bỏ thay đổi?', 'Click again to discard': 'Bấm lần nữa để bỏ thay đổi',
 'Name': 'Tên', 'Key': 'Phím', 'Size': 'Kích thước', 'Position': 'Vị trí', 'Delete': 'Xoá', 'Click again to delete': 'Bấm lần nữa để xoá',
 'Up': 'Lên', 'Left': 'Trái', 'Down': 'Xuống', 'Right': 'Phải', 'Apply size to all four': 'Dùng cỡ này cho cả 4 nút',
 'New profile': 'Profile mới', 'Rename': 'Đổi tên', 'Duplicate': 'Nhân bản', 'Delete profile': 'Xoá profile', 'Import…': 'Nhập từ file…', 'Export profile': 'Xuất profile', 'Export all profiles': 'Xuất tất cả profile',
 'Detect running game': 'Nhận diện game đang chạy', 'Detected: ': 'Đã nhận diện: ', 'Could not detect the running game': 'Không nhận diện được game đang chạy', 'Clear game': 'Bỏ gắn game',
 'Show key hints while playing': 'Hiện gợi ý phím khi chơi', 'Auto-select profile for the running game': 'Tự chọn profile theo game đang chạy', 'Profile selected for ': 'Đã chọn profile cho ',
 'No controls yet. Add one above.': 'Chưa có điều khiển nào. Hãy thêm ở trên.', 'Select a control to edit it': 'Chọn một điều khiển để chỉnh sửa',
 'Press a key to assign…': 'Nhấn một phím để gán…', 'Not assigned': 'Chưa gán',
 'Key mapping': 'Ánh xạ phím', 'This key is reserved': 'Phím này dành cho cửa sổ', 'Invalid key': 'Phím không hợp lệ', 'Key already used by ': 'Phím đã dùng bởi ',
 'Too many controls': 'Quá nhiều điều khiển', 'Too many profiles': 'Quá nhiều profile', 'Too many keys held (max 9)': 'Giữ quá nhiều phím cùng lúc (tối đa 9)',
 'Game Key Mapping on — mapped keys tap the screen': 'Ánh xạ phím game đang bật — phím đã gán sẽ chạm vào màn hình', 'Game Key Mapping off': 'Đã tắt ánh xạ phím game',
 'Finish editing the key mapping first': 'Hãy hoàn tất chỉnh sửa ánh xạ phím trước', 'Edit': 'Sửa', 'Stop': 'Dừng', 'Collapse': 'Thu gọn', 'Expand': 'Mở rộng', 'More': 'Thêm',
 'Imported ': 'Đã nhập ', ' profile(s)': ' profile', 'Exported to ': 'Đã xuất ra ', 'Invalid JSON file': 'File JSON không hợp lệ', 'Not a LUMIR key mapping file': 'Không phải file ánh xạ phím của LUMIR', 'No profiles found in this file': 'Không có profile nào trong file này',
 'Key mapping file is unreadable — started with an empty profile': 'Không đọc được file ánh xạ phím — dùng profile trống',
 'Key mapping changed in another window': 'Ánh xạ phím đã đổi ở cửa sổ khác', 'Control channel lost': 'Mất kênh điều khiển', 'Device disconnected': 'Thiết bị đã ngắt kết nối',
 'Android · ': 'Android · ', 'landscape': 'ngang', 'portrait': 'dọc', 'Profile made in ': 'Profile được tạo ở chế độ ',
 'Key mapping file is too large': 'File ánh xạ phím quá lớn', 'Too many profiles ': 'Quá nhiều profile'
});

/* ───────────── Biểu tượng (nét 1.8, khung 24 — cùng phong cách phone.js) ───────────── */
const IC = {
 pad: '<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
 joy: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/><path d="M12 5.2v1.4M12 17.4v1.4M5.2 12h1.4M17.4 12h1.4"/>',
 dpad: '<path d="M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z"/>',
 btn: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/>',
 plus: '<path d="M12 5v14M5 12h14"/>', more: '<circle cx="5" cy="12" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="19" cy="12" r="1.2" fill="currentColor"/>',
 trash: '<path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12.5h9.4L17.5 7M10 11v5M14 11v5"/>', pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
 copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2"/>',
 down: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>', up: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
 eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>', eyeoff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A16.8 16.8 0 0 0 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
 cu: '<path d="M6 14l6-6 6 6"/>', cd: '<path d="M6 10l6 6 6-6"/>', stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>', crosshair: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>'
};
const ic = n => `<svg viewBox="0 0 24 24" aria-hidden="true">${IC[n]}</svg>`;

/* ───────────── Trạng thái (riêng của Game Key Mapping) ───────────── */
const DEMO_KEY = 'lumir-keymap-demo';   /* chỉ dùng khi mở phone.html bằng trình duyệt (chế độ demo, không có Rust) */
let store = null, draft = null, baseFp = '';
let mode = 'off', resume = 'off';       /* off | edit | play; resume = chế độ quay về khi Huỷ chỉnh sửa */
let sel = null, capture = null, armed = null, collapsed = false, externalPending = false;
let engine = null, layer = null, ctls = null, hud = null, panel = null, fileIn = null;
const els = new Map(), knobs = new Map(), jkeys = new Map();   /* phần tử DOM đang hiển thị, để vẽ nhanh khi chơi */
let raf = 0, wd = 0, lastLand = null, hideT = 0, autoSeq = 0;
/* Con mắt trên thanh nhỏ: ẩn/hiện các nút vẽ trên màn hình khi chơi. Chỉ là hiển thị — phím vẫn chạy (engine không biết gì về việc này). Nhớ lựa chọn. */
const VIS_KEY = 'lumir-keymap-controls-hidden';
let ctlHidden = false; try { ctlHidden = localStorage.getItem(VIS_KEY) === '1'; } catch (_) {}
function setCtlHidden(v) { ctlHidden = v; try { localStorage.setItem(VIS_KEY, v ? '1' : '0'); } catch (_) {} renderHud(); }

const phoneEl = $('#phone');
/* Toạ độ chuẩn hoá tính trên canvas video (đúng như `norm` của phone.js), không tính viền 1px của khung. */
const area = () => cv.getBoundingClientRect();
/* Kích thước khung được nhớ lại (cập nhật bằng ResizeObserver) — engine gọi geom() mỗi khung hình + 50ms,
   getBoundingClientRect() ở đó là ép trình duyệt tính lại layout liên tục. */
const G = { w: 0, h: 0 };
const refreshGeom = () => { const r = area(); G.w = r.width; G.h = r.height; };
const geom = () => { if (!G.w || !G.h) refreshGeom(); return G; };
const cur = () => (mode === 'edit' && draft ? draft : store);
const prof = () => C.activeProfile(cur());
const ctlById = id => prof().controls.find(c => c.id === id);
const posOf = (c, slot) => (c.type === 'dpad' ? c.buttons[slot] : c);
const isDirty = () => !!draft && C.fingerprint(draft) !== baseFp;
const aspect = () => { const g = geom(); return g.h ? g.w / g.h : 0.45; };

/* ───────────── Lưu trữ ───────────── */
async function readDisk() {
  let txt = '';
  try { txt = demo ? (localStorage.getItem(DEMO_KEY) || '') : ((await call('keymap_load')) || ''); }
  catch (e) { toast(T(String(e))); }
  return txt;
}
async function loadStore() {
  const txt = await readDisk();
  try { store = C.parseStore(txt); }
  catch (_) { store = C.defaultStore(); toast(T('Key mapping file is unreadable — started with an empty profile')); }
  baseFp = C.fingerprint(store);
}
async function writeStore(s) {
  const json = C.serialize(s);
  if (demo) localStorage.setItem(DEMO_KEY, json); else await call('keymap_save', { json });
}
/* Cửa sổ khác (thiết bị khác) vừa lưu: nạp lại, nhưng không làm gián đoạn lượt chơi nếu cấu hình đang dùng không đổi. */
async function reloadFromDisk() {
  if (mode === 'edit') { externalPending = true; return; }
  let next; try { next = C.parseStore(await readDisk()); } catch (_) { return; }
  if (C.fingerprint(next) === C.fingerprint(store)) return;
  const before = JSON.stringify(C.activeProfile(store).controls), id = store.activeProfileId;
  store = next; baseFp = C.fingerprint(store);
  if (!store.profiles.some(p => p.id === id)) store.activeProfileId = store.profiles[0].id; else store.activeProfileId = id;
  if (mode === 'play') { if (JSON.stringify(C.activeProfile(store).controls) !== before) { engine.setProfile(C.activeProfile(store)); renderControls(); } renderHud(); }
  toast(T('Key mapping changed in another window'));
}

/* ───────────── Gửi chạm (hàng đợi tuần tự riêng; chỉ giữ Move mới nhất của mỗi ngón) ───────────── */
const tq = []; let tbusy = false, errAt = 0;
function send(pointer, phase, x, y) {
  if (phase === 'move') for (let i = tq.length - 1; i >= 0; i--) if (tq[i].pointer === pointer) { if (tq[i].phase === 'move') { tq[i].x = x; tq[i].y = y; return; } break; }
  tq.push({ pointer, phase, x, y });
  if (!tbusy) pump();
}
async function pump() {
  tbusy = true;
  while (tq.length) {
    const it = tq.shift();
    try { await call('touch_pointer', { serial: P.serial, pointer: it.pointer, phase: it.phase, x: it.x, y: it.y, landscape: P.landscape() }); }
    catch (e) {
      tq.length = 0; engine.reset(); flushBackend();   /* kênh hỏng: quên trạng thái cục bộ, nhả hết phía Rust */
      const n = Date.now(); if (n - errAt > 2000) { errAt = n; toast(T(String(e))); }
    }
  }
  tbusy = false;
}
/* Rust nhả mọi ngón còn giữ (đồng thời chặn Move tới muộn). Chạy được cả khi mất kết nối. */
function flushBackend() { if (!demo && P.serial) call('touch_release_all', { serial: P.serial }).catch(() => {}); }

/* ───────────── Chế độ ───────────── */
function setMode(m) {
  const was = mode;
  if (was === 'play' && m !== 'play') { engine.releaseAll(); flushBackend(); }
  mode = m; capture = null; armed = null;
  if (m !== 'off') refreshGeom();
  clearTimeout(hideT);
  if (m !== 'edit') { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); }   /* nút đang focus sẽ "ăn" phím Space/Enter của game */
  const rb = $('.rb[data-t=map]'); if (rb) { rb.classList.toggle('on', m !== 'off'); rb.setAttribute('aria-pressed', String(m !== 'off')); }
  if (m === 'off') {
    layer.classList.remove('on'); panel.classList.remove('on');
    hideT = setTimeout(() => { if (mode === 'off') { layer.hidden = true; panel.hidden = true; ctls.innerHTML = ''; els.clear(); } }, 260);
    stopLoop();
  } else {
    layer.hidden = false; layer.dataset.mode = m; layer.classList.toggle('hints', store.settings.hints);
    if (m === 'edit') { panel.hidden = false; requestAnimationFrame(() => { placePanel(); panel.classList.add('on'); }); stopLoop(); }
    else { panel.classList.remove('on'); hideT = setTimeout(() => { if (mode !== 'edit') panel.hidden = true; }, 260); }
    renderAll();
    requestAnimationFrame(() => layer.classList.add('on'));
    if (m === 'play') { engine.setProfile(C.activeProfile(store)); startLoop(); }
  }
}
function startPlay() {
  const p = C.activeProfile(store); p.lastUsedAt = Date.now();
  writeStore(store).catch(() => {});
  setMode('play');
  toast(T('Game Key Mapping on — mapped keys tap the screen'));
}
function enterEdit() {
  resume = mode === 'play' ? 'play' : 'off';
  draft = C.clone(store); sel = null; baseFp = C.fingerprint(store); externalPending = false;
  setMode('edit'); autoSelect();
}
function exitEdit(to) {
  draft = null; sel = null; capture = null;
  if (to === 'play' && P.connected) startPlay(); else setMode(to === 'play' ? 'off' : to);
  if (externalPending) { externalPending = false; reloadFromDisk(); }
}
function cancelEdit(force) {
  if (!force && isDirty() && !arm('cancel')) return;
  baseFp = C.fingerprint(store);
  exitEdit(resume);
}
function toggle() {
  if (mode === 'off') enterEdit();
  else if (mode === 'play') { setMode('off'); toast(T('Game Key Mapping off')); }
  else cancelEdit();
}
function setOn(on) { if (on) { if (mode === 'off') enterEdit(); } else if (mode === 'edit') cancelEdit(true); else if (mode !== 'off') setMode('off'); }

/* Bấm lần 1 = "xin xác nhận" (3 giây), lần 2 mới thực hiện. Dùng cho Huỷ khi có thay đổi và Xoá. */
function arm(key) {
  if (armed && armed.key === key) { clearTimeout(armed.t); armed = null; return true; }
  if (armed) clearTimeout(armed.t);
  armed = { key, t: setTimeout(() => { armed = null; renderPanel(); }, 3000) };
  renderPanel(); return false;
}

async function saveDraft() {
  const p = C.activeProfile(draft), now = Date.now(), dv = P.device || {};
  p.updatedAt = now; p.platform = { os: 'android', device: String(dv.name || p.platform.device || ''), resolution: String(dv.resolution || p.platform.resolution || ''), orientation: P.landscape() ? 'landscape' : 'portrait' };
  let next; try { next = C.normStore(C.clone(draft)); } catch (e) { toast(T(String(e.message || e))); return false; }
  try { await writeStore(next); } catch (e) { toast(T(String(e))); return false; }
  store = next; draft = C.clone(store); baseFp = C.fingerprint(store);
  renderAll(); toast(T('Saved')); return true;
}

/* ───────────── Game đang chạy → profile ───────────── */
async function detectGame() {
  if (demo || !P.serial) return '';
  try { return (await call('foreground_app', { serial: P.serial })) || ''; } catch (_) { return ''; }
}
const prettyPkg = p => { const s = (p.split('.').pop() || p).replace(/[_-]+/g, ' '); return s.charAt(0).toUpperCase() + s.slice(1); };
async function autoSelect() {
  if (!store.settings.autoSelect) return;
  const seq = ++autoSeq, startMode = mode;
  const pkg = await detectGame();
  if (!pkg || seq !== autoSeq || mode !== startMode || isDirty()) return;
  const list = C.profilesForGame(store, pkg);
  if (!list.length || list.some(p => p.id === store.activeProfileId)) return;
  store.activeProfileId = list[0].id;
  if (draft) draft.activeProfileId = list[0].id;
  baseFp = C.fingerprint(store);
  if (mode === 'play') engine.setProfile(C.activeProfile(store));
  sel = null; renderAll();
  toast(T('Profile selected for ') + (list[0].game.label || pkg));
}

/* ───────────── Vẽ các điều khiển trên màn hình ───────────── */
const kl = code => C.keyLabel(code);
function place(el, o) { el.style.left = (o.x * 100) + '%'; el.style.top = (o.y * 100) + '%'; el.style.setProperty('--sz', o.size); }
function keyText(code) { return code ? kl(code) : '+'; }
function mk(c, slot) {
  const el = document.createElement('div');
  el.className = 'gk-c gk-' + (c.type === 'joystick' ? 'joy' : c.type === 'dpad' ? 'dp' : 'tap');
  el.dataset.id = c.id; if (slot) el.dataset.slot = slot;
  const o = posOf(c, slot); place(el, o);
  let h = '<i class="gk-body"></i>';
  if (c.type === 'joystick') {
    h += '<i class="gk-knob"></i>' + ['u:up', 'l:left', 'd:down', 'r:right'].map(s => { const [cl, d] = s.split(':'); const k = c.keys[d]; return `<b class="gk-jk ${cl}${k ? '' : ' none'}" data-d="${d}">${esc(k ? kl(k) : '·')}</b>`; }).join('');
    h += `<span class="gk-nm">${esc(c.name)}</span>`;
  } else {
    const k = c.type === 'dpad' ? o.key : c.key, t = keyText(k);
    h += `<b class="gk-kl${k ? '' : ' none'}${t.length > 2 ? ' long' : ''}">${esc(t)}</b>`;
    if (c.type === 'button') h += `<span class="gk-nm">${esc(c.name)}</span>`;
  }
  el.innerHTML = h + '<u class="gk-rz" title="' + esc(T('Size')) + '"></u>';
  return el;
}
function renderControls() {
  ctls.innerHTML = ''; els.clear(); knobs.clear(); jkeys.clear();
  for (const c of prof().controls) {
    const list = c.type === 'dpad' ? C.DIRS.map(d => mk(c, d)) : [mk(c, '')];
    list.forEach(el => {
      ctls.appendChild(el); els.set(c.id + ':' + (el.dataset.slot || ''), el);
      if (c.type === 'joystick') { knobs.set(c.id, el.querySelector('.gk-knob')); jkeys.set(c.id, $$('.gk-jk', el)); }
    });
  }
  paintSel();
}
function paintSel() {
  for (const [k, el] of els) {
    const [id, slot] = k.split(':'); const on = !!sel && sel.id === id;
    el.classList.toggle('sel', on && (el.classList.contains('gk-dp') ? sel.slot === slot : true));
    el.classList.toggle('grp', on && el.classList.contains('gk-dp'));
  }
}
function refreshEl(c, slot) {   /* sau khi đổi tên/phím/cỡ: vẽ lại đúng phần tử đó */
  const old = els.get(c.id + ':' + (slot || '')); if (!old) return renderControls();
  const el = mk(c, slot); el.style.animation = 'none';
  old.replaceWith(el); els.set(c.id + ':' + (slot || ''), el);
  if (c.type === 'joystick') { knobs.set(c.id, el.querySelector('.gk-knob')); jkeys.set(c.id, $$('.gk-jk', el)); }
  paintSel();
}

/* Vòng lặp khi chơi: trượt joystick + vẽ trạng thái nhấn. rAF cho mượt, bộ đếm 50ms dự phòng để lần nhả đang chờ luôn được thực hiện. */
let paintedIdle = false;
function tick() {
  const t = performance.now(); engine.update(t);
  const l = P.landscape(); if (lastLand !== null && l !== lastLand) { engine.releaseAll(); flushBackend(); } lastLand = l;
  if (engine.idle) { if (paintedIdle) return; paintedIdle = true; } else paintedIdle = false;   /* rảnh và đã vẽ trạng thái "nhả" rồi → không duyệt DOM nữa */
  const v = engine.view();
  for (const [k, el] of els) {
    const j = v.joy.get(el._id || (el._id = el.dataset.id)), on = j ? j.on : v.pressed.has(k);
    if (el._d !== on) { el._d = on; el.classList.toggle('down', on); }
  }
  for (const [id, kn] of knobs) {
    const j = v.joy.get(id); if (!j) continue;
    kn.style.setProperty('--kx', j.x.toFixed(3)); kn.style.setProperty('--ky', j.y.toFixed(3));
    for (const h of jkeys.get(id) || []) {
      const d = h.dataset.d, on = j.on && ((d === 'up' && j.y < -.3) || (d === 'down' && j.y > .3) || (d === 'left' && j.x < -.3) || (d === 'right' && j.x > .3));
      if (h._o !== on) { h._o = on; h.classList.toggle('on', on); }
    }
  }
}
function startLoop() { stopLoop(); paintedIdle = false; lastLand = P.landscape(); const f = () => { tick(); raf = requestAnimationFrame(f); }; raf = requestAnimationFrame(f); wd = setInterval(() => { if (!engine.idle) engine.update(performance.now()); }, 50); }
function stopLoop() { cancelAnimationFrame(raf); clearInterval(wd); raf = 0; wd = 0; }

/* ───────────── HUD khi chơi ───────────── */
function renderHud() {
  const s = store;
  hud.innerHTML = `<select aria-label="${esc(T('Profile'))}">${s.profiles.map(p => `<option value="${p.id}"${p.id === s.activeProfileId ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` +
    `<button type="button" data-a="edit" title="${esc(T('Edit'))}" aria-label="${esc(T('Edit'))}">${ic('pen')}</button><button type="button" class="stop" data-a="stop" title="${esc(T('Stop'))}" aria-label="${esc(T('Stop'))}">${ic('stop')}</button>` +
    `<button type="button" class="eye${ctlHidden ? ' off' : ''}" data-a="eye" title="${esc(T(ctlHidden ? 'Show controls' : 'Hide controls'))}" aria-label="${esc(T(ctlHidden ? 'Show controls' : 'Hide controls'))}" aria-pressed="${ctlHidden}">${ic(ctlHidden ? 'eyeoff' : 'eye')}</button>`;
  layer.classList.toggle('vis-off', ctlHidden);
}

/* ───────────── Bảng công cụ ───────────── */
function ctlSummary(c) { return c.type === 'button' ? kl(c.key) : C.DIRS.map(d => kl(c.type === 'joystick' ? c.keys[d] : c.buttons[d].key) || '·').join(''); }
const TYPE_NAME = { joystick: 'Circular Joystick', dpad: 'Directional Joystick', button: 'Custom Button' };
const TYPE_ICON = { joystick: 'joy', dpad: 'dpad', button: 'btn' };
const DIR_NAME = { up: 'Up', left: 'Left', down: 'Down', right: 'Right' }, DIR_ARROW = { up: '↑', left: '←', down: '↓', right: '→' };

function propsHtml() {
  const c = sel && ctlById(sel.id);
  if (!c) return `<div class="gk-empty">${esc(T('Select a control to edit it'))}</div>`;
  const slot = c.type === 'dpad' ? (sel.slot || 'up') : '', o = posOf(c, slot);
  let keys;
  if (c.type === 'button') keys = `<div class="gk-keys one">${chip(c, '', c.key, '')}</div>`;
  else keys = `<div class="gk-keys">${C.DIRS.map(d => chip(c, d, c.type === 'joystick' ? c.keys[d] : c.buttons[d].key, DIR_ARROW[d])).join('')}</div>`;
  const dp = c.type === 'dpad';
  return `<div class="gk-props" data-id="${c.id}">
   <div class="gk-ph2">${ic(TYPE_ICON[c.type])}<span>${esc(T(TYPE_NAME[c.type]))}</span><button type="button" class="gk-ib sm dng" data-act="rm" title="${esc(T('Delete'))}" aria-label="${esc(T('Delete'))}">${ic('trash')}</button></div>
   <label class="gk-s"><span class="gk-l">${esc(T('Name'))}</span><input type="text" data-f="name" maxlength="${C.LIM.ctlName}" value="${esc(c.name)}"></label>
   <div class="gk-s"><span class="gk-l">${esc(T('Key'))}</span>${keys}</div>
   <div class="gk-s"><div class="gk-sl"><span class="gk-l">${esc(T('Size'))}${dp ? ' · ' + esc(T(DIR_NAME[slot])) : ''}</span><b data-v="size">${Math.round(o.size * 100)}%</b></div>
     <input type="range" data-f="size" min="${C.LIM.minSize * 100}" max="${C.LIM.maxSize * 100}" step="1" value="${Math.round(o.size * 100)}">
     ${dp ? `<button type="button" class="gk-link" data-act="sizeall">${esc(T('Apply size to all four'))}</button>` : ''}</div>
   <div class="gk-s"><span class="gk-l">${esc(T('Position'))}${dp ? ' · ' + esc(T(DIR_NAME[slot])) : ''} (X / Y %)</span><div class="gk-two"><input type="number" data-f="x" min="0" max="100" step="0.5" value="${(o.x * 100).toFixed(1)}"><input type="number" data-f="y" min="0" max="100" step="0.5" value="${(o.y * 100).toFixed(1)}"></div></div>
  </div>`;
}
function chip(c, slot, code, arrow) {
  const capOn = capture && capture.id === c.id && capture.slot === slot, selOn = c.type === 'dpad' && sel && sel.slot === slot;
  return `<button type="button" class="gk-chip${code ? '' : ' none'}${capOn ? ' cap' : ''}${selOn ? ' sel' : ''}" data-act="key" data-slot="${slot}" aria-label="${esc(T('Key'))} ${arrow}">${arrow ? `<small>${arrow}</small>` : ''}<b>${esc(capOn ? T('Press a key to assign…') : code ? kl(code) : T('Not assigned'))}</b></button>`;
}
function renderProps() { const h = $('#gkProps', panel); if (h) h.innerHTML = propsHtml(); }

function renderPanel() {
  if (!draft) return;
  const pr = C.activeProfile(draft), d = isDirty(), a = armed && armed.key;
  const plat = pr.platform, land = P.landscape() ? 'landscape' : 'portrait';
  const note = [pr.game && pr.game.package, plat.resolution && ('Android · ' + plat.resolution + ' · ' + T(plat.orientation))].filter(Boolean).join('  ');
  const warn = pr.controls.length && plat.orientation !== land && plat.resolution ? `<div class="gk-small">${esc(T('Profile made in ') + T(plat.orientation))}</div>` : '';
  panel.innerHTML = `
  <div class="gk-ph" data-drag><span class="gk-pi">${ic('pad')}</span><b>${esc(T('Game Key Mapping'))}</b><i class="gk-dirty" ${d ? '' : 'hidden'}></i><span class="sp"></span>
    <button type="button" class="gk-ib sm" data-act="collapse" title="${esc(T(collapsed ? 'Expand' : 'Collapse'))}" aria-label="${esc(T(collapsed ? 'Expand' : 'Collapse'))}">${ic(collapsed ? 'cd' : 'cu')}</button></div>
  <div class="gk-pb">
   <div class="gk-s"><span class="gk-l">${esc(T('Profile'))}</span>
    <div class="gk-row"><select id="gkProf" aria-label="${esc(T('Profile'))}">${draft.profiles.map(p => `<option value="${p.id}"${p.id === draft.activeProfileId ? ' selected' : ''}>${esc(p.name)}${p.game && p.game.label ? ' · ' + esc(p.game.label) : ''}</option>`).join('')}</select>
     <button type="button" class="gk-ib" data-act="newp" title="${esc(T('New profile'))}" aria-label="${esc(T('New profile'))}">${ic('plus')}</button>
     <button type="button" class="gk-ib" data-act="menu" title="${esc(T('More'))}" aria-label="${esc(T('More'))}">${ic('more')}</button></div>
    <input type="text" id="gkName" maxlength="${C.LIM.name}" value="${esc(pr.name)}" placeholder="${esc(T('Profile name'))}" aria-label="${esc(T('Profile name'))}">
    <div class="gk-row"><input type="text" id="gkGame" maxlength="${C.LIM.game}" value="${esc(pr.game ? pr.game.label : '')}" placeholder="${esc(T('Game name'))}" aria-label="${esc(T('Game name'))}">
     <button type="button" class="gk-ib" data-act="detect" title="${esc(T('Detect running game'))}" aria-label="${esc(T('Detect running game'))}">${ic('crosshair')}</button></div>
    ${note ? `<div class="gk-small">${esc(note)}</div>` : ''}${warn}
   </div>
   <div class="gk-s"><span class="gk-l">${esc(T('Add controls'))}</span><div class="gk-add">
     ${['joystick', 'dpad', 'button'].map(t => `<button type="button" data-act="add" data-t="${t}">${ic(TYPE_ICON[t])}<span>${esc(T(TYPE_NAME[t]))}</span></button>`).join('')}</div></div>
   <div class="gk-s"><span class="gk-l">${esc(T('Controls'))} (${pr.controls.length})</span>
    ${pr.controls.length ? `<div class="gk-list">${pr.controls.map(c => `<button type="button" class="gk-li${sel && sel.id === c.id ? ' sel' : ''}" data-act="pick" data-id="${c.id}">${ic(TYPE_ICON[c.type])}<span>${esc(c.name)}</span><em>${esc(ctlSummary(c))}</em></button>`).join('')}</div>` : `<div class="gk-empty">${esc(T('No controls yet. Add one above.'))}</div>`}</div>
   <div id="gkProps">${propsHtml()}</div>
   <div class="gk-s"><span class="gk-l">${esc(T('Options'))}</span>
    <label class="gk-chk"><input type="checkbox" data-o="hints"${draft.settings.hints ? ' checked' : ''}>${esc(T('Show key hints while playing'))}</label>
    <label class="gk-chk"><input type="checkbox" data-o="autoSelect"${draft.settings.autoSelect ? ' checked' : ''}>${esc(T('Auto-select profile for the running game'))}</label></div>
  </div>
  <div class="gk-pf"><button type="button" class="gk-btn" data-act="save"${d ? '' : ' disabled'}>${esc(T('Save'))}</button><button type="button" class="gk-btn pri" data-act="done">${esc(T('Done'))}</button>
   <button type="button" class="gk-btn${a === 'cancel' ? ' warn' : ''}" data-act="cancel">${esc(T(a === 'cancel' ? 'Click again to discard' : 'Cancel'))}</button></div>
  <div class="gk-menu" id="gkMenu" role="menu">
   <button type="button" data-act="rename">${ic('pen')}${esc(T('Rename'))}</button><button type="button" data-act="dup">${ic('copy')}${esc(T('Duplicate'))}</button>
   <button type="button" class="dng${a === 'delp' ? ' armed' : ''}" data-act="delp">${ic('trash')}${esc(T(a === 'delp' ? 'Click again to delete' : 'Delete profile'))}</button><hr>
   <button type="button" data-act="imp">${ic('up')}${esc(T('Import…'))}</button><button type="button" data-act="exp">${ic('down')}${esc(T('Export profile'))}</button><button type="button" data-act="expall">${ic('down')}${esc(T('Export all profiles'))}</button></div>`;
  panel.classList.toggle('min', collapsed);
  if (armed && armed.key === 'delp') $('#gkMenu', panel).classList.add('open');
}
function renderAll() {
  if (mode === 'edit') renderPanel();
  renderControls(); renderHud();
  layer.classList.toggle('hints', store.settings.hints);
}
let dirtyRaf = 0;
function paintDirty() { dirtyRaf = 0; if (!panel) return; const d = $('.gk-dirty', panel), s = $('[data-act=save]', panel); const v = isDirty(); if (d) d.hidden = !v; if (s) s.disabled = !v; }
/* Kéo / đổi cỡ bắn pointermove rất dày: chỉ so sánh "đã sửa chưa" tối đa một lần mỗi khung hình. */
function markDirty() { if (!dirtyRaf) dirtyRaf = requestAnimationFrame(paintDirty); }

/* ── Thao tác chỉnh sửa ── */
function select(id, slot) {
  const c = id && ctlById(id); sel = c ? { id, slot: c.type === 'dpad' ? (slot || 'up') : '' } : null;
  capture = null; paintSel(); renderProps();
  $$('.gk-li', panel).forEach(b => b.classList.toggle('sel', !!sel && b.dataset.id === sel.id));
}
function addControl(type) {
  const p = C.activeProfile(draft);
  if (p.controls.length >= C.LIM.controls) return toast(T('Too many controls'));
  const n = p.controls.filter(c => c.type === type).length, land = P.landscape();
  const base = type === 'button' ? { x: land ? .82 : .78, y: land ? .62 : .72 }
    : type === 'dpad' ? { x: land ? .17 : .25, y: land ? .36 : .46 }   /* tách khỏi joystick để hai cái mới thêm không đè lên nhau */
    : { x: land ? .17 : .25, y: land ? .68 : .76 };
  const step = (n % 6) * .06;
  const opt = { x: Math.min(.95, base.x + (type === 'button' ? -step : step)), y: Math.max(.05, base.y - step), aspect: aspect(), name: T(type === 'joystick' ? 'Move' : type === 'dpad' ? 'D-pad' : 'Button') + (n ? ' ' + (n + 1) : '') };
  if (type === 'button') { delete opt.keys; }
  const c = C.makeControl(type, opt);
  /* phím mặc định WASD đã bị dùng thì để trống thay vì gán trùng */
  const owners = C.keyOwners(p);
  for (const s of C.keySlots(c)) if (s.get() && owners.has(s.get())) s.set('');
  p.controls.push(c); renderControls(); select(c.id, type === 'dpad' ? 'up' : ''); markDirty(); renderPanel();
  if (sel) { const l = $(`.gk-li[data-id="${c.id}"]`, panel); if (l) l.scrollIntoView({ block: 'nearest' }); }
}
function removeSelected() {
  if (!sel) return;
  const p = C.activeProfile(draft), i = p.controls.findIndex(c => c.id === sel.id); if (i < 0) return;
  p.controls.splice(i, 1); sel = null; capture = null; renderControls(); renderPanel();
}
function beginCapture(slot) { if (!sel) return; capture = { id: sel.id, slot }; if (sel && ctlById(sel.id).type === 'dpad') sel.slot = slot; paintSel(); renderProps(); }
function handleCapture(e) {
  const code = e.code;
  if (code === 'Escape') { capture = null; renderProps(); return; }
  const r = C.assignKey(C.activeProfile(draft), capture.id, capture.slot, code);
  if (!r.ok) {
    if (r.reason === 'reserved') toast(T('This key is reserved'));
    else if (r.reason === 'used') toast(T('Key already used by ') + `“${r.by.control.name}”` + (r.by.control.type === 'button' ? '' : ' ' + (DIR_ARROW[r.by.slot] || '')));
    else toast(T('Invalid key'));
    return;
  }
  const c = ctlById(capture.id), slot = capture.slot; capture = null;
  refreshEl(c, slot); renderPanel();
}
function setField(f, raw) {
  if (!sel) return; const c = ctlById(sel.id); if (!c) return;
  if (f === 'name') { c.name = String(raw).slice(0, C.LIM.ctlName); const l = $(`.gk-li[data-id="${c.id}"] span`, panel); if (l) l.textContent = c.name || ' '; const nm = els.get(c.id + ':')?.querySelector('.gk-nm'); if (nm) nm.textContent = c.name; markDirty(); return; }
  const o = posOf(c, c.type === 'dpad' ? sel.slot : ''), v = parseFloat(raw); if (!isFinite(v)) return;
  if (f === 'size') o.size = C.clamp(v / 100, C.LIM.minSize, C.LIM.maxSize);
  if (f === 'x') o.x = C.clamp(v / 100, 0, 1);
  if (f === 'y') o.y = C.clamp(v / 100, 0, 1);
  const el = els.get(c.id + ':' + (c.type === 'dpad' ? sel.slot : '')); if (el) place(el, o);
  markDirty(); syncProps(o, f);
}
function syncProps(o, except) {
  const set = (f, v) => { if (f === except) return; const i = $(`#gkProps [data-f=${f}]`, panel); if (i) i.value = v; };
  set('size', Math.round(o.size * 100)); set('x', (o.x * 100).toFixed(1)); set('y', (o.y * 100).toFixed(1));
  const b = $('#gkProps [data-v=size]', panel); if (b) b.textContent = Math.round(o.size * 100) + '%';
}

/* ── Kéo / đổi cỡ trực tiếp trên màn hình ── */
let drag = null;
function onDown(e) {
  if (mode !== 'edit' || e.button > 0) return;
  const el = e.target.closest('.gk-c');
  if (!el) { if (e.target === layer.querySelector('.gk-shade') || e.target === ctls) select(null); return; }
  e.preventDefault();
  const c = ctlById(el.dataset.id); if (!c) return;
  const slot = el.dataset.slot || '';
  select(c.id, slot);
  const o = posOf(c, slot), r = area();
  drag = { pid: e.pointerId, el, o, size: !!e.target.closest('.gk-rz'), ox: (e.clientX - r.left) / r.width - o.x, oy: (e.clientY - r.top) / r.height - o.y, moved: false };
  try { el.setPointerCapture(e.pointerId); } catch (_) {}
  el.classList.add('dragging');
}
function onMove(e) {
  if (!drag || e.pointerId !== drag.pid) return;
  const r = area(), o = drag.o;
  if (drag.size) {
    const cx = r.left + o.x * r.width, cy = r.top + o.y * r.height, U = Math.min(r.width, r.height);
    o.size = C.clamp(2 * Math.hypot(e.clientX - cx, e.clientY - cy) / U, C.LIM.minSize, C.LIM.maxSize);
  } else {
    o.x = C.clamp((e.clientX - r.left) / r.width - drag.ox, 0, 1); o.y = C.clamp((e.clientY - r.top) / r.height - drag.oy, 0, 1);
  }
  drag.moved = true; place(drag.el, o); syncProps(o, ''); markDirty();
}
function onUp(e) { if (!drag || e.pointerId !== drag.pid) return; drag.el.classList.remove('dragging'); drag = null; }

/* ── Kéo bảng công cụ ── */
let pdrag = null;
const panelBox = () => { const r = panel.getBoundingClientRect(); return { w: r.width, h: r.height }; };   /* kích thước nhìn thấy (đã nhân tỉ lệ phóng) */
function placePanel() {
  const pb = panelBox(), w = pb.w || 264, h = pb.h || 300, W = innerWidth, H = innerHeight;
  const sp = (draft || store).settings.panel;
  const left = sp ? sp.x * Math.max(0, W - w) : Math.max(6, W - w - 70), top = sp ? sp.y * Math.max(0, H - h) : 44;
  panel.style.left = C.clamp(left, 0, Math.max(0, W - w)) + 'px'; panel.style.top = C.clamp(top, 0, Math.max(0, H - h)) + 'px';
}
function panelDown(e) {
  const h = e.target.closest('.gk-ph'); if (!h || e.target.closest('button') || e.button > 0) return;
  const r = panel.getBoundingClientRect(); pdrag = { pid: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
  h.setPointerCapture(e.pointerId); panel.classList.add('dragging'); e.preventDefault();
}
function panelMove(e) {
  if (!pdrag || e.pointerId !== pdrag.pid) return;
  const { w, h } = panelBox();
  panel.style.left = C.clamp(e.clientX - pdrag.dx, 0, Math.max(0, innerWidth - w)) + 'px'; panel.style.top = C.clamp(e.clientY - pdrag.dy, 0, Math.max(0, innerHeight - h)) + 'px';
}
function panelUp(e) {
  if (!pdrag || e.pointerId !== pdrag.pid) return; pdrag = null; panel.classList.remove('dragging');
  const { w, h } = panelBox(), r = panel.getBoundingClientRect();
  const pos = { x: C.clamp(r.left / Math.max(1, innerWidth - w), 0, 1), y: C.clamp(r.top / Math.max(1, innerHeight - h), 0, 1) };
  store.settings.panel = pos; if (draft) draft.settings.panel = pos;   /* nhớ vị trí, nhưng kéo bảng không tính là "đã sửa cấu hình" */
}

/* ── Hành động trên bảng ── */
function download(name, text) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name + '.json';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function doExport(all) {
  const p = C.activeProfile(draft), json = all ? C.exportAll(draft) : C.exportProfile(p), name = all ? 'LUMIR keymap - all profiles' : 'LUMIR keymap - ' + p.name;
  try {
    if (demo) { download(name, json); toast(T('Exported to ') + name + '.json'); }
    else toast(T('Exported to ') + await call('keymap_export', { name, json }));
  } catch (e) { toast(T(String(e))); }
}
function doImport(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try { const n = C.importProfiles(draft, C.parseImport(String(rd.result))); sel = null; renderAll(); toast(T('Imported ') + n + T(' profile(s)')); }
    catch (e) { toast(T(String(e.message || e))); }
  };
  rd.onerror = () => toast(T('Invalid JSON file'));
  rd.readAsText(file);
}
async function act(a, b) {
  const menu = $('#gkMenu', panel);
  if (a !== 'delp' && menu) menu.classList.remove('open');
  switch (a) {
    case 'collapse': collapsed = !collapsed; renderPanel(); placePanel(); break;
    case 'save': await saveDraft(); break;
    case 'done': if (await saveDraft()) exitEdit('play'); break;
    case 'cancel': cancelEdit(); break;
    case 'add': addControl(b.dataset.t); break;
    case 'pick': select(b.dataset.id, ''); break;
    case 'rm': removeSelected(); break;
    case 'key': beginCapture(b.dataset.slot); break;
    case 'sizeall': { const c = sel && ctlById(sel.id); if (c && c.type === 'dpad') { const s = c.buttons[sel.slot].size; C.DIRS.forEach(d => { c.buttons[d].size = s; }); renderControls(); markDirty(); } break; }
    case 'menu': menu.classList.toggle('open'); break;
    case 'newp': try { C.addProfile(draft, T('Profile') + ' ' + (draft.profiles.length + 1), { orientation: P.landscape() ? 'landscape' : 'portrait' }); sel = null; renderAll(); $('#gkName', panel).select(); } catch (e) { toast(T(String(e.message))); } break;
    case 'rename': $('#gkName', panel).focus(); $('#gkName', panel).select(); break;
    case 'dup': try { C.duplicateProfile(draft, draft.activeProfileId); sel = null; renderAll(); } catch (e) { toast(T(String(e.message))); } break;
    case 'delp': if (arm('delp')) { C.deleteProfile(draft, draft.activeProfileId); sel = null; renderAll(); } break;
    case 'imp': fileIn.value = ''; fileIn.click(); break;
    case 'exp': doExport(false); break;
    case 'expall': doExport(true); break;
    case 'detect': {
      const pkg = await detectGame(); if (!pkg) return toast(T('Could not detect the running game'));
      const pr = C.activeProfile(draft); pr.game = { package: pkg, label: (pr.game && pr.game.label) || prettyPkg(pkg) };
      renderPanel(); toast(T('Detected: ') + pkg); break;
    }
  }
}

/* ───────────── Bàn phím ───────────── */
const typing = t => !!(t && t.closest && t.closest('input:not([type=range]):not([type=checkbox]),textarea,[contenteditable]'));
/* phone.js gọi khi đang bật (chỉnh sửa hoặc chơi); true = đã xử lý, phone.js bỏ qua phím này. */
function key(e) {
  if (mode === 'edit') {
    if (capture) { e.preventDefault(); handleCapture(e); return true; }
    if (typing(e.target)) return false;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeSelected(); return true; }
    return false;
  }
  if (mode === 'play' && !typing(e.target)) { if (engine.keyDown(e.code)) { e.preventDefault(); return true; } }
  return false;
}
window.addEventListener('keyup', e => { if (mode === 'play' && engine.keyUp(e.code)) e.preventDefault(); }, true);
/* Mất focus / ẩn cửa sổ / đóng: nhả hết phím và ngón chạm, kẻo kẹt phím trong game. */
function releaseEverything() { if (mode === 'play') engine.releaseAll(); flushBackend(); }
window.addEventListener('blur', releaseEverything);
window.addEventListener('pagehide', releaseEverything);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseEverything(); });
window.addEventListener('lumir:device', e => {
  if (e.detail && e.detail.connected) return;
  if (mode === 'play') { engine.reset(); tq.length = 0; setMode('off'); toast(T('Device disconnected')); }
  flushBackend();
});

/* ───────────── Khởi tạo ───────────── */
function build() {
  layer = document.createElement('div'); layer.className = 'gk'; layer.id = 'gk'; layer.hidden = true;
  layer.innerHTML = '<div class="gk-shade"></div><div class="gk-ctls"></div><div class="gk-hud" role="toolbar"></div>';
  phoneEl.appendChild(layer); ctls = layer.querySelector('.gk-ctls'); hud = layer.querySelector('.gk-hud');
  panel = document.createElement('section'); panel.className = 'gk-panel'; panel.id = 'gkPanel'; panel.hidden = true; panel.setAttribute('aria-label', 'Game Key Mapping');
  document.body.appendChild(panel);
  if (window.LumirPopups) window.LumirPopups.attach(panel, { id: 'keymap', move: false });   /* kéo bảng do panelDown xử lý; popups lo phóng/thu */
  fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = '.json,application/json'; fileIn.hidden = true; document.body.appendChild(fileIn);
  fileIn.addEventListener('change', () => doImport(fileIn.files && fileIn.files[0]));

  const rb = $('.rb[data-t=map]'); if (rb) rb.addEventListener('click', () => rb.blur());
  layer.addEventListener('pointerdown', onDown); layer.addEventListener('pointermove', onMove); layer.addEventListener('pointerup', onUp); layer.addEventListener('pointercancel', onUp);
  panel.addEventListener('pointerdown', panelDown); panel.addEventListener('pointermove', panelMove); panel.addEventListener('pointerup', panelUp); panel.addEventListener('pointercancel', panelUp);
  panel.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && panel.contains(b)) { e.preventDefault(); act(b.dataset.act, b); } else if (!e.target.closest('#gkMenu')) { const m = $('#gkMenu', panel); if (m) m.classList.remove('open'); } });
  panel.addEventListener('input', e => {
    const t = e.target;
    if (t.id === 'gkName') { const p = C.activeProfile(draft); p.name = t.value.slice(0, C.LIM.name); const o = $('#gkProf option:checked', panel); if (o) o.textContent = p.name + (p.game && p.game.label ? ' · ' + p.game.label : ''); markDirty(); }
    else if (t.id === 'gkGame') { const p = C.activeProfile(draft), v = t.value.slice(0, C.LIM.game); p.game = v || (p.game && p.game.package) ? { package: p.game ? p.game.package : '', label: v } : null; markDirty(); }
    else if (t.dataset.f) setField(t.dataset.f, t.value);
  });
  panel.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'gkProf') { draft.activeProfileId = t.value; sel = null; capture = null; renderAll(); }
    else if (t.dataset.o) { draft.settings[t.dataset.o] = t.checked; layer.classList.toggle('hints', draft.settings.hints); markDirty(); }
  });
  hud.addEventListener('change', e => {
    if (e.target.tagName !== 'SELECT') return;
    store.activeProfileId = e.target.value; e.target.blur();
    const p = C.activeProfile(store); p.lastUsedAt = Date.now();
    engine.setProfile(p); renderControls(); baseFp = C.fingerprint(store); writeStore(store).catch(() => {});
  });
  hud.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; b.blur(); if (b.dataset.a === 'edit') enterEdit(); else if (b.dataset.a === 'stop') toggle(); else if (b.dataset.a === 'eye') setCtlHidden(!ctlHidden); });
  document.addEventListener('pointerdown', e => {   /* bấm ra ngoài bảng thì thôi chờ gán phím */
    if (capture && !e.target.closest('.gk-chip')) { capture = null; if (mode === 'edit') renderProps(); }
  }, true);

  new ResizeObserver(() => { refreshGeom(); layer.style.setProperty('--u', Math.min(G.w, G.h) + 'px'); }).observe(phoneEl);
  new ResizeObserver(refreshGeom).observe(cv);
  addEventListener('resize', () => { if (mode === 'edit') placePanel(); });
  /* Đổi ngôn ngữ ở cửa sổ chính: phone.js đã cập nhật `lang` (nghe trước); vẽ lại chữ của mình. */
  addEventListener('storage', e => { if (e.key === 'lumir' && mode !== 'off') { renderAll(); } });
  if (!demo && TA && TA.event) TA.event.listen('keymap-changed', ev => { try { if (ev.payload !== TA.window.getCurrentWindow().label) reloadFromDisk(); } catch (_) {} }).catch(() => {});
}

engine = new C.Engine({ send, geom, onExhausted: () => toast(T('Too many keys held (max 9)')) });
window.LumirKeymap = { get on() { return mode !== 'off'; }, get editing() { return mode === 'edit'; }, get mode() { return mode; }, set: setOn, toggle, key, release: releaseEverything };
build();
loadStore().then(() => renderHud());
})();