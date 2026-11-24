'use strict';
/* Smoke test: nạp index.html và phone.html trong jsdom (chế độ demo, không có Tauri) và kiểm tra khởi động không lỗi,
   các popup mở/đóng được. Chạy được chỉ khi có jsdom (npm i); không có thì bỏ qua để `npm run test:core` vẫn xanh. */
const test = require('node:test');
const { after } = test;
const assert = require('node:assert/strict');
const path = require('node:path');
let JSDOM, VirtualConsole; try { ({ JSDOM, VirtualConsole } = require('jsdom')); } catch (_) {}
const skip = !JSDOM && 'cần jsdom (npm install)';
const SRC = path.join(__dirname, '..', 'src');

const ctx2d = () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : k === 'canvas' ? null : (k === 'getImageData' ? () => ({ data: [] }) : () => ctx2d())), set: (t, k, v) => { t[k] = v; return true; } });

const memStorage = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), clear: () => m.clear(), key: i => [...m.keys()][i] ?? null, get length() { return m.size; } }; };
const alive = new Set(); const closeAll = () => alive.forEach(w => { try { w.close(); } catch (_) {} });
after(closeAll); process.on('exit', closeAll);   /* kể cả khi một test lỗi giữa chừng, tiến trình vẫn thoát */

async function load(page) {
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push(String((e && (e.detail && e.detail.stack || e.stack)) || e).split('\n')[0]));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  const dom = await JSDOM.fromFile(path.join(SRC, page), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      Object.defineProperty(w, 'localStorage', { value: memStorage(), configurable: true });
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
      w.HTMLCanvasElement.prototype.getContext = () => ctx2d();
      w.Element.prototype.setPointerCapture = () => {}; w.Element.prototype.releasePointerCapture = () => {};
      w.Element.prototype.scrollIntoView = () => {};
    },
  });
  await new Promise(res => { if (dom.window.document.readyState === 'complete') res(); else dom.window.addEventListener('load', res); });
  await new Promise(r => setTimeout(r, 150));
  alive.add(dom.window);
  return { dom, w: dom.window, d: dom.window.document, errors };
}
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true }));

test('phone.html khởi động không lỗi và dựng đủ thanh nút', { skip }, async () => {
  const { w, d, errors, dom } = await load('phone.html');
  assert.deepEqual(errors, [], 'lỗi khi khởi động: ' + errors.join(' | '));
  assert.ok(d.querySelectorAll('#rail .rb').length >= 5, 'thanh nút bên phải phải có các nút');
  for (const g of ['LumirPerf', 'LumirPlayout', 'LumirKeymap', 'LumirKeymapCore']) assert.ok(w[g], 'thiếu window.' + g);
  for (const g of ['popups', 'quality']) assert.ok(w.Lumir && w.Lumir[g], 'thiếu Lumir.' + g);
  dom.window.close();
});

test('phone.html: các popup mở và đóng qua nút trên thanh', { skip }, async () => {
  const { w, d, errors, dom } = await load('phone.html');
  const btn = t => d.querySelector(`#rail .rb[data-t="${t}"]`);
  const tags = [...d.querySelectorAll('#rail .rb')].map(b => b.dataset.t);
  for (const [t, sel] of [['qual', '#qp'], ['perf', '#perfPanel']]) {
    assert.ok(btn(t), `không có nút ${t} (có: ${tags})`);
    const el = d.querySelector(sel);
    assert.equal(el.hidden, true, sel + ' phải ẩn lúc đầu');
    click(w, btn(t)); assert.equal(el.hidden, false, sel + ' phải mở sau khi bấm');
    click(w, btn(t)); assert.equal(el.hidden, true, sel + ' phải đóng sau khi bấm lại');
  }
  assert.deepEqual(errors, [], errors.join(' | '));
  dom.window.close();
});

test('phone.html: bảng chất lượng — chọn FPS và độ đệm mạng lưu được cài đặt', { skip }, async () => {
  const { w, d, dom } = await load('phone.html');
  click(w, d.querySelector('#rail .rb[data-t="qual"]'));
  click(w, d.querySelector('#qpFps [data-f="90"]'));
  click(w, d.querySelector('#qpBuf [data-b="35"]'));
  const saved = JSON.parse(w.localStorage.getItem('lumir-q'));
  assert.equal(saved.fps, 90); assert.equal(saved.buf, 35);
  assert.equal(d.querySelector('#qpBufV').textContent, '+35 ms');
  dom.window.close();
});

test('phone.html: bảng PERF hiện đủ ô chỉ số và có nút xuất CSV', { skip }, async () => {
  const { w, d, dom } = await load('phone.html');
  click(w, d.querySelector('#rail .rb[data-t="perf"]'));
  for (const id of ['perfFps1', 'perfFps5', 'perfArrive', 'perfRtt', 'perfLoss', 'perfDropped', 'perfLag', 'perfLong', 'perfGpu', 'perfCoalesce', 'perfExport'])
    assert.ok(d.getElementById(id), 'thiếu #' + id);
  dom.window.close();
});

test('index.html khởi động không lỗi', { skip }, async () => {
  const { d, errors, dom } = await load('index.html');
  assert.deepEqual(errors, [], errors.join(' | '));
  assert.ok(d.querySelector('header'), 'thiếu header');
  dom.window.close();
});

test('phone.html: bảng Game Key Mapping mở ở chế độ sửa rồi đóng lại', { skip }, async () => {
  const { w, d, errors, dom } = await load('phone.html');
  const btn = d.querySelector('#rail .rb[data-t="map"]');
  assert.ok(btn, 'không có nút map');
  click(w, btn);
  await new Promise(r => setTimeout(r, 120));
  const panel = d.querySelector('.gk-panel');
  assert.ok(panel, 'chưa dựng .gk-panel');
  assert.ok(panel.classList.contains('on'), 'bảng phải hiện (class on) sau khi bấm');
  assert.ok(panel._pz, 'bảng phải được gắn phóng/thu (popups)');
  click(w, btn);
  await new Promise(r => setTimeout(r, 120));
  assert.equal(panel.classList.contains('on'), false, 'bảng phải ẩn sau khi bấm lại');
  assert.deepEqual(errors, [], errors.join(' | '));
  dom.window.close();
});

test('phone.html: popup có thể kéo và phóng/thu (qp, perf)', { skip }, async () => {
  const { w, d, dom } = await load('phone.html');
  for (const id of ['qp', 'perfPanel']) {
    const el = d.getElementById(id);
    assert.ok(el._pz, id + ' chưa gắn popups');
    assert.ok(el.querySelector('.pz-grip'), id + ' thiếu góc phóng/thu');
    el._pz.setScale(1.5);
    assert.match(el.style.transform, /scale\(1\.5\)/);
    el._pz.reset();
  }
  dom.window.close();
});

test('registry: bấm ra ngoài đóng bảng chất lượng nhưng không đóng PERF; nút của chính nó vẫn bật/tắt', { skip }, async () => {
  const { w, d, dom } = await load('phone.html');
  const qual = d.querySelector('#rail .rb[data-t="qual"]'), perf = d.querySelector('#rail .rb[data-t="perf"]');
  click(w, perf); click(w, qual);   /* mở PERF trước: bấm nút PERF khi bảng chất lượng đang mở sẽ đóng bảng đó (bấm ra ngoài) */
  assert.equal(d.getElementById('qp').hidden, false); assert.equal(d.getElementById('perfPanel').hidden, false);
  assert.equal(qual.classList.contains('on'), true, 'nút qual phải sáng khi popup mở');
  click(w, d.getElementById('stage'));   /* bấm ra ngoài */
  assert.equal(d.getElementById('qp').hidden, true, 'bảng chất lượng phải đóng khi bấm ra ngoài');
  assert.equal(qual.classList.contains('on'), false);
  assert.equal(d.getElementById('perfPanel').hidden, false, 'PERF không đóng khi bấm ra ngoài (outside:false)');
  click(w, perf); assert.equal(d.getElementById('perfPanel').hidden, true, 'nút PERF bật/tắt chính nó');
  click(w, qual); click(w, d.querySelector('#rail .rb[data-t="perf"]'));
  assert.equal(d.getElementById('qp').hidden, true, 'bấm nút khác trên thanh thì đóng bảng chất lượng');
  dom.window.close();
});

test('registry: Esc đóng từng popup một, popup mở sau cùng trước', { skip }, async () => {
  const { w, d, dom } = await load('phone.html');
  click(w, d.querySelector('#rail .rb[data-t="perf"]')); click(w, d.querySelector('#rail .rb[data-t="qual"]'));
  const esc = () => d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  esc(); assert.equal(d.getElementById('qp').hidden, true, 'lần Esc 1 đóng bảng mở sau cùng (chất lượng)'); assert.equal(d.getElementById('perfPanel').hidden, false);
  esc(); assert.equal(d.getElementById('perfPanel').hidden, true, 'lần Esc 2 đóng PERF');
  dom.window.close();
});

test('registry: owns() nhận phần tử trong popup (kể cả bảng Key Mapping), từ chối phần tử ngoài', { skip }, async () => {
  const { w, d, dom } = await load('phone.html');
  const P = w.Lumir.popups;
  assert.equal(P.owns(d.getElementById('qpFps')), true);
  assert.equal(P.owns(d.getElementById('perfFps1')), true);
  assert.equal(P.owns(d.getElementById('stage')), false);
  click(w, d.querySelector('#rail .rb[data-t="map"]'));
  assert.equal(P.owns(d.querySelector('.gk-panel .gk-ph') || d.querySelector('.gk-panel')), true);
  dom.window.close();
});

test('popup chất lượng: bản dịch tiếng Việt vẫn áp dụng (từ điển do chính popup mang theo)', { skip }, async () => {
  const dom = await (async () => {
    const r = await load('phone.html'); return r;   /* nạp bản mặc định để lấy hàm; ngôn ngữ đặt qua localStorage ở lần nạp sau */
  })();
  dom.dom.window.close();
  const errors = [], vc = new VirtualConsole(); vc.on('jsdomError', e => errors.push(String(e)));
  const d2 = await JSDOM.fromFile(path.join(SRC, 'phone.html'), {
    runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      const st = memStorage(); st.setItem('lumir', JSON.stringify({ lang: 'vi' }));
      Object.defineProperty(w, 'localStorage', { value: st, configurable: true });
      w.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
      w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      w.HTMLCanvasElement.prototype.getContext = () => ctx2d();
    },
  });
  alive.add(d2.window);
  await new Promise(r => setTimeout(r, 400));
  const doc = d2.window.document, txt = s => doc.querySelector(s).textContent;
  assert.equal(txt('#qp .qp-h'), 'Chất lượng video');
  assert.equal(txt('#qpSeg [data-m="smooth"]'), 'Mượt');
  assert.equal(txt('#qpD'), 'Chất lượng tốt, độ trễ thấp');
  assert.equal(txt('#qpBufV'), 'Tắt');
  assert.equal(doc.querySelector('#qp .pz-grip').title, 'Kéo để phóng/thu · Ctrl+cuộn · nhấp đúp để về 100%');
  assert.deepEqual(errors, []);
  d2.window.close();
});
