/* LUMIR · Popup có thể di chuyển + phóng/thu.
   LumirPopups.attach(el, { id, handle, move, grip })
     - Di chuyển: kéo phần `handle` (selector con của el). move:false = el đã có cách kéo riêng.
     - Phóng/thu: kéo góc dưới-phải, hoặc Ctrl + lăn chuột trên popup; nhấp đúp vào góc = về 100%.
     - Nhớ vị trí + tỉ lệ (localStorage, theo id) và luôn giữ popup trong cửa sổ.
   Phóng bằng transform: scale (gốc ở góc trên-trái) nên chữ vẫn nét và bố cục bên trong không đổi. */
(() => {
'use strict';
const MIN_S = 0.6, MAX_S = 2.5, KEY = 'lumir-popup:';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const P = window.LumirPhone, T = P && P.T ? P.T : k => k;
if (P && P.VI) Object.assign(P.VI, { 'Drag to zoom · Ctrl+wheel · double-click to reset': 'Kéo để phóng/thu · Ctrl+cuộn · nhấp đúp để về 100%', 'Drag to move': 'Kéo để di chuyển' });
const HINT = 'Drag to zoom · Ctrl+wheel · double-click to reset';
const NO_DRAG = 'button,input,select,textarea,a,label,[contenteditable]';

function attach(el, o = {}) {
  if (!el || el._pz) return el && el._pz;
  const id = o.id || el.id, handleSel = o.handle, movable = o.move !== false;
  let s = 1, placed = false;   /* placed = đã có left/top tường minh (người dùng đã kéo hoặc đã khôi phục) */
  let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY + id) || 'null'); } catch (_) {}
  if (saved && Number.isFinite(saved.s)) s = clamp(saved.s, MIN_S, MAX_S);

  const apply = () => { el.style.transformOrigin = '0 0'; el.style.transform = s === 1 ? '' : `scale(${s})`; };
  const save = () => {
    try {
      const r = el.getBoundingClientRect();
      localStorage.setItem(KEY + id, JSON.stringify({ s, x: placed && movable ? r.left / innerWidth : null, y: placed && movable ? r.top / innerHeight : null }));
    } catch (_) {}
  };
  /* Đổi sang left/top tường minh (CSS gốc đặt bằng right/bottom — nếu phóng khi còn neo phải/dưới thì popup lan ra ngoài màn hình) */
  const place = (left, top) => { el.style.left = left + 'px'; el.style.top = top + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'; placed = true; };
  const materialize = () => { if (!placed) { const r = el.getBoundingClientRect(); place(r.left, r.top); } };
  const fit = () => {   /* giữ popup trong cửa sổ (kích thước nhìn thấy = bao gồm tỉ lệ) */
    if (el.hidden || !placed) return;
    const r = el.getBoundingClientRect(); if (!r.width) return;
    place(clamp(r.left, 0, Math.max(0, innerWidth - r.width)), clamp(r.top, 0, Math.max(0, innerHeight - r.height)));
  };
  const maxScale = () => Math.max(MIN_S, Math.min(MAX_S, (innerWidth - 4) / (el.offsetWidth || 1), (innerHeight - 4) / (el.offsetHeight || 1)));
  const setScale = v => { materialize(); s = clamp(v, MIN_S, maxScale()); apply(); fit(); save(); };

  apply();

  /* ── Di chuyển ── */
  let mv = null;
  if (movable) {
    const h = handleSel ? el.querySelector(handleSel) : el;
    if (h) {
      h.classList.add('pz-handle'); if (!h.title) h.title = T('Drag to move');
      h.addEventListener('pointerdown', e => {
        if (e.button > 0 || e.target.closest(NO_DRAG)) return;
        materialize(); const r = el.getBoundingClientRect();
        mv = { pid: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top };
        try { h.setPointerCapture(e.pointerId); } catch (_) {}
        el.classList.add('pz-moving'); e.preventDefault();
      });
      h.addEventListener('pointermove', e => {
        if (!mv || e.pointerId !== mv.pid) return;
        const r = el.getBoundingClientRect();
        place(clamp(e.clientX - mv.dx, 0, Math.max(0, innerWidth - r.width)), clamp(e.clientY - mv.dy, 0, Math.max(0, innerHeight - r.height)));
      });
      const end = e => { if (!mv || e.pointerId !== mv.pid) return; mv = null; el.classList.remove('pz-moving'); save(); };
      h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
    }
  }

  /* ── Phóng / thu bằng góc dưới-phải ── */
  const grip = document.createElement('i');
  grip.className = 'pz-grip' + (o.grip === 'sticky' ? ' sticky' : ''); grip.title = T(HINT); grip.setAttribute('aria-hidden', 'true');
  grip.innerHTML = '<svg viewBox="0 0 12 12"><path d="M11 5L5 11M11 8L8 11"/></svg>';
  el.appendChild(grip);
  /* Bảng có thể bị dựng lại bằng innerHTML (bảng ánh xạ phím) → gắn lại góc phóng/thu nếu bị xoá */
  new MutationObserver(() => { if (grip.parentNode !== el) el.appendChild(grip); }).observe(el, { childList: true });
  let zm = null;
  grip.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    materialize(); const r = el.getBoundingClientRect();
    zm = { pid: e.pointerId, l: r.left, t: r.top, diag: Math.hypot(el.offsetWidth, el.offsetHeight) || 1 };
    try { grip.setPointerCapture(e.pointerId); } catch (_) {}
    el.classList.add('pz-moving'); e.preventDefault(); e.stopPropagation();
  });
  grip.addEventListener('pointermove', e => {
    if (!zm || e.pointerId !== zm.pid) return;
    s = clamp(Math.hypot(e.clientX - zm.l, e.clientY - zm.t) / zm.diag, MIN_S, maxScale()); apply();
  });
  const zend = e => { if (!zm || e.pointerId !== zm.pid) return; zm = null; el.classList.remove('pz-moving'); fit(); save(); };
  grip.addEventListener('pointerup', zend); grip.addEventListener('pointercancel', zend);
  grip.addEventListener('dblclick', () => setScale(1));

  /* Ctrl + lăn chuột trên popup */
  el.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault(); setScale(s * (e.deltaY < 0 ? 1.06 : 1 / 1.06));
  }, { passive: false });

  /* Khôi phục vị trí khi popup được hiện; giữ trong cửa sổ khi đổi cỡ cửa sổ */
  const restore = () => {
    if (el.hidden) return;
    if (movable && !placed && saved && saved.x != null && saved.y != null) place(saved.x * innerWidth, saved.y * innerHeight);
    fit();
  };
  new MutationObserver(restore).observe(el, { attributes: true, attributeFilter: ['hidden', 'class'] });
  addEventListener('resize', () => { fit(); });
  restore();

  el._pz = { get scale() { return s; }, setScale, fit, reset() { setScale(1); } };
  return el._pz;
}

window.LumirPopups = { attach };
attach(document.getElementById('qp'), { id: 'qp', handle: '.qp-h' });
attach(document.getElementById('perfPanel'), { id: 'perf', handle: '.perf-head', grip: 'sticky' });
})();
