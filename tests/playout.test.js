'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Playout } = require('../src/scripts/playout.js');

/* Đồng hồ + rAF giả: mỗi vsync 1000/60 ms; sự kiện "khung tới" xen kẽ theo thời gian. */
function sim({ arrivals, delay, vsync = 1000 / 60, until }) {
  let T = 0, rafCb = null; const painted = [], dropped = [], closedTwice = new Set(), closed = new Set();
  const p = new Playout({
    now: () => T, raf: cb => { rafCb = cb; return 1; }, caf: () => { rafCb = null; },
    paint: f => { painted.push({ id: f.id, t: T }); if (closed.has(f.id)) closedTwice.add(f.id); closed.add(f.id); },
    close: f => { if (closed.has(f.id)) closedTwice.add(f.id); closed.add(f.id); }, onDrop: () => dropped.push(T),
  });
  p.delay = delay;
  const ev = arrivals.map(a => ({ t: a.t, id: a.id })).sort((x, y) => x.t - y.t);
  let ei = 0, nextV = vsync;
  while (T <= until) {
    const tn = Math.min(ei < ev.length ? ev[ei].t : Infinity, nextV);
    T = tn;
    while (ei < ev.length && ev[ei].t <= T) { p.push({ id: ev[ei].id }); ei++; }
    if (T >= nextV) { nextV += vsync; const cb = rafCb; rafCb = null; if (cb) cb(T); }
  }
  return { p, painted, dropped, closedTwice, ev };
}
const gaps = a => a.slice(1).map((x, i) => x.t - a[i].t);

/* nguồn 30 fps; mỗi 30 khung có một khung kẹt `spike` ms, các khung sau dồn về cùng lúc */
function wifiArrivals(n, spike) {
  const out = []; let id = 0;
  for (let i = 0; i < n; i++) {
    const src = i * 33.33;
    const inSpike = i % 30 === 29;
    if (inSpike) { const t = src + spike; for (let k = 0; k < 3; k++) out.push({ t: t + k * 0.3, id: id++ }); i += 2; }
    else out.push({ t: src, id: id++ });
  }
  return out;
}

test('delay 0 là vẽ theo nhịp thô: có khoảng hở lớn khi mạng kẹt', () => {
  const r = sim({ arrivals: wifiArrivals(300, 60), delay: 0, until: 10500 });
  assert.ok(Math.max(...gaps(r.painted)) >= 60);
});

test('đệm 70 ms che được cú kẹt 60 ms: khoảng hở lớn nhất ≤ 2 nhịp vsync + một chút', () => {
  const raw = sim({ arrivals: wifiArrivals(300, 60), delay: 0, until: 10500 });
  const buf = sim({ arrivals: wifiArrivals(300, 60), delay: 70, until: 10500 });
  const gmax = a => Math.max(...gaps(a.painted.slice(5)));
  assert.ok(gmax(buf) < gmax(raw), `đệm ${gmax(buf).toFixed(1)} phải nhỏ hơn thô ${gmax(raw).toFixed(1)}`);
  assert.ok(gmax(buf) <= 55, `khoảng hở lớn nhất ${gmax(buf).toFixed(1)} ms`);
});

test('độ trễ thêm bị chặn: mỗi khung được vẽ không muộn quá delay + vài nhịp so với lúc tới', () => {
  const r = sim({ arrivals: wifiArrivals(300, 60), delay: 70, until: 10500 });
  const arr = new Map(r.ev.map(e => [e.id, e.t]));
  const late = r.painted.slice(5).map(x => x.t - arr.get(x.id));
  assert.ok(Math.max(...late) <= 70 + 4 * 33.4, `trễ lớn nhất ${Math.max(...late).toFixed(1)} ms`);
});

test('khung đầu tiên (và sau khi nguồn đứng im) chờ đúng delay để dựng đệm', () => {
  const r = sim({ arrivals: [{ t: 10, id: 0 }, { t: 2000, id: 1 }], delay: 70, until: 2400 });
  assert.equal(r.painted.length, 2);
  assert.ok(r.painted[0].t >= 80 && r.painted[0].t <= 80 + 17, `đầu: ${r.painted[0].t}`);
  assert.ok(r.painted[1].t >= 2070 && r.painted[1].t <= 2070 + 17, `sau đứng im: ${r.painted[1].t}`);
});

test('dồn cục 40 khung cùng lúc: hàng đợi không vượt trần, độ trễ không phình', () => {
  const arrivals = Array.from({ length: 40 }, (_, i) => ({ t: 100 + i * 0.1, id: i }));
  const r = sim({ arrivals, delay: 70, until: 1000 });
  assert.ok(r.p.depth <= Math.ceil(70 / r.p.I) + 2);
  assert.ok(r.dropped.length >= 30);
  assert.ok(Math.max(...r.painted.map(x => x.t)) < 100 + 70 + 200);
});

test('mọi khung đưa vào đều được vẽ hoặc đóng đúng một lần (không rò rỉ, không đóng đôi)', () => {
  const r = sim({ arrivals: wifiArrivals(300, 90), delay: 35, until: 12000 });
  r.p.clear();
  assert.equal(r.closedTwice.size, 0);
  assert.equal(r.painted.length + r.dropped.length, r.ev.length);
});

test('clear() đóng khung đang chờ và huỷ lịch rAF', () => {
  let h = 0, closed = 0; let T = 0;
  const p = new Playout({ now: () => T, raf: () => (h = 7), caf: () => { h = 0; }, paint() {}, close: () => closed++ });
  p.delay = 70; p.push({ id: 1 }); p.push({ id: 2 });
  p.clear();
  assert.equal(closed, 2); assert.equal(p.depth, 0); assert.equal(h, 0);
});
