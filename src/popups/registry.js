/* LUMIR · popups/registry.js — nơi DUY NHẤT quản lý popup của cửa sổ điện thoại.
 *
 * Mỗi popup là một file riêng trong thư mục này, tự đăng ký bằng một khai báo:
 *
 *   Lumir.popups.register({
 *     id: 'quality',            // tên dùng để mở/đóng: Lumir.popups.toggle('quality')
 *     el: '#qp',                // phần tử (selector, hàm trả về phần tử, hoặc chính phần tử)
 *     button: 'qual',           // nút trên thanh bên (data-t): bấm = bật/tắt popup, và nút sáng khi popup mở
 *     handle: '.qp-h',          // vùng kéo di chuyển (bỏ qua nếu move:false)
 *     outside: true,            // bấm ra ngoài thì đóng
 *     esc: true,                // phím Esc đóng popup (mỗi lần Esc đóng popup mở sau cùng)
 *     onShow() {}, onHide() {}, // móc khi mở / đóng
 *   });
 *
 * Popup do module khác tự điều khiển hiển thị (ví dụ bảng Key Mapping có hiệu ứng riêng) khai báo `external: true`:
 * registry chỉ gắn kéo/phóng-thu và đưa vào danh sách "thuộc về popup" (owns), không đụng tới hidden/class của nó.
 *
 * Việc thêm popup mới = thêm một file ở đây + một dòng <script> trong phone.html. Không phải sửa phone.js.
 */
(() => {
'use strict';
const L = (window.Lumir = window.Lumir || {});
const defs = new Map();        /* id → { def, el, open } */
const stack = [];              /* id theo thứ tự mở; cuối = trên cùng */
const q = s => document.querySelector(s);

function elOf(p) {
  if (!p.el) { const e = p.def.el; p.el = typeof e === 'string' ? q(e) : typeof e === 'function' ? e() : e; if (p.el && !p.decorated) decorate(p); }
  return p.el;
}
function decorate(p) {
  p.decorated = true;
  if (p.def.move === false && p.def.zoom === false) return;
  if (L.popups.base) L.popups.base.attach(p.el, { id: p.def.persist || p.def.id, handle: p.def.handle, move: p.def.move, grip: p.def.grip });
}
function railBtn(p) { return p.def.button ? q(`.rb[data-t="${p.def.button}"]`) : null; }
function syncBtn(p) { const b = railBtn(p); if (b) { b.classList.toggle('on', p.open); b.setAttribute('aria-pressed', String(p.open)); } }

function set(id, on) {
  const p = defs.get(id); if (!p || p.def.external) return false;
  const el = elOf(p); if (!el) return false;
  on = !!on; const was = p.open; p.open = on; el.hidden = !on;
  const i = stack.indexOf(id); if (i >= 0) stack.splice(i, 1); if (on) stack.push(id);
  syncBtn(p);
  if (on !== was) { try { (on ? p.def.onShow : p.def.onHide) && (on ? p.def.onShow : p.def.onHide)(); } catch (e) { console.error('[popup ' + id + ']', e); } }
  return on;
}
const isOpen = id => { const p = defs.get(id); return !!p && (p.def.external ? !!(p.el && !p.el.hidden) : p.open); };

function register(def) {
  if (!def || !def.id) throw new Error('popup cần id');
  if (defs.has(def.id)) throw new Error('popup trùng id: ' + def.id);
  const p = { def, el: null, open: false, decorated: false };
  defs.set(def.id, p);
  const el = elOf(p);
  if (el && !def.external) p.open = !el.hidden;
  return { open: () => set(def.id, true), close: () => set(def.id, false), toggle: () => set(def.id, !isOpen(def.id)), get el() { return elOf(p); } };
}

/* Phần tử có nằm trong popup nào không (để phím gõ / chuột không "lọt" xuống điện thoại khi đang thao tác trong popup). */
function owns(node) {
  if (!node || !node.closest) return false;
  for (const p of defs.values()) { const el = p.el; if (el && el.contains(node)) return true; }
  return false;
}
/* Esc: đóng popup mở sau cùng có esc !== false. Trả true nếu đã đóng một popup. */
function closeTop() {
  for (let i = stack.length - 1; i >= 0; i--) { const p = defs.get(stack[i]); if (p && p.def.esc !== false) { set(p.def.id, false); return true; } }
  return false;
}
/* Đổi ngôn ngữ: dịch lại chú thích kéo/phóng-thu. */
function relabel(T) { for (const p of defs.values()) if (p.el && L.popups.base) L.popups.base.relabel(p.el, T); }

/* Một bộ lắng nghe chung cho tất cả popup: nút trên thanh bên + bấm ra ngoài. */
document.addEventListener('click', e => {
  const t = e.target; if (!t || !t.closest) return;
  const rb = t.closest('.rb');
  for (const p of defs.values()) {
    if (p.def.external) continue;
    const mine = rb && p.def.button && rb.dataset.t === p.def.button;
    if (mine) { set(p.def.id, !p.open); continue; }
    if (p.open && p.def.outside && !(p.el && p.el.contains(t))) set(p.def.id, false);
  }
});

L.popups = Object.assign(L.popups || {}, { register, open: id => set(id, true), close: id => set(id, false), toggle: id => set(id, !isOpen(id)), isOpen, owns, closeTop, relabel });
})();
