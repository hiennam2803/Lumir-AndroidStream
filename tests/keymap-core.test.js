'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/scripts/keymap-core.js');

const near = (a, b, e = 1e-6) => assert.ok(Math.abs(a - b) <= e, `${a} ≉ ${b}`);

/* ───────────── Schema / chuẩn hoá ───────────── */
test('default store is valid and normalising it changes nothing', () => {
  const s = C.defaultStore();
  const n = C.normStore(JSON.parse(C.serialize(s)));
  assert.equal(C.fingerprint(n), C.fingerprint(s));
  assert.equal(n.profiles.length, 1);
  assert.equal(n.activeProfileId, n.profiles[0].id);
});

test('empty text → default store; wrong schema is rejected', () => {
  assert.equal(C.parseStore('').profiles.length, 1);
  assert.equal(C.parseStore('   ').profiles.length, 1);
  assert.throws(() => C.parseStore('{"schema":"other"}'), /Not a LUMIR/);
  assert.throws(() => C.parseStore('[]'), /Not a LUMIR/);
  assert.throws(() => C.parseStore('{bad'));
});

test('coordinates and sizes are clamped to the normalised 0..1 space', () => {
  const s = C.normStore({ schema: C.SCHEMA, version: 1, profiles: [{ id: 'p', name: 'x', controls: [
    { type: 'button', id: 'a', key: 'KeyQ', x: 5, y: -3, size: 99 },
    { type: 'joystick', id: 'b', x: 'abc', y: NaN, size: 0 },
    { type: 'nonsense', id: 'c' }, null, 7
  ] }] });
  const [a, b] = s.profiles[0].controls;
  assert.equal(s.profiles[0].controls.length, 2, 'loại control lạ bị bỏ');
  assert.deepEqual([a.x, a.y, a.size], [1, 0, C.LIM.maxSize]);
  assert.deepEqual([b.x, b.y, b.size], [0.5, 0.5, C.LIM.minSize]);
});

test('duplicate ids, duplicate keys, bad and reserved keys are repaired, not fatal', () => {
  const s = C.normStore({ schema: C.SCHEMA, version: 1, profiles: [
    { id: 'p', name: 'A', controls: [
      { type: 'button', id: 'same', key: 'KeyQ', x: .1, y: .1 },
      { type: 'button', id: 'same', key: 'KeyQ', x: .2, y: .2 },       // trùng id + trùng phím
      { type: 'button', id: 'z', key: 'F11', x: .3, y: .3 },           // phím của cửa sổ
      { type: 'button', id: 'y', key: '../../x', x: .3, y: .3 },       // rác
      { type: 'button', id: 'w', key: 'Escape', x: .3, y: .3 }
    ] },
    { id: 'p', name: 'B', controls: [] }                               // trùng id profile
  ] });
  const ids = s.profiles[0].controls.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(s.profiles.map(p => p.id)).size, 2);
  assert.deepEqual(s.profiles[0].controls.map(c => c.key), ['KeyQ', '', '', '', '']);
});

test('invalid activeProfileId falls back; zero profiles still yields one', () => {
  const s = C.normStore({ schema: C.SCHEMA, version: 1, activeProfileId: 'nope', profiles: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] });
  assert.equal(s.activeProfileId, 'a');
  assert.equal(C.normStore({ schema: C.SCHEMA, version: 1, profiles: [] }).profiles.length, 1);
});

test('fuzz: whatever garbage goes in, output is always inside 0..1 and every key is valid & unique', () => {
  const junk = () => [0, 1, -1, 0.5, 7, NaN, Infinity, 'x', null, undefined, {}, [], 'KeyW', 'KeyA', 'F11'][Math.floor(Math.random() * 15)];
  for (let i = 0; i < 300; i++) {
    const ctl = () => ({ type: ['joystick', 'dpad', 'button', 'x'][Math.floor(Math.random() * 4)], id: junk(), name: junk(), x: junk(), y: junk(), size: junk(), key: junk(),
      keys: { up: junk(), left: junk(), down: junk(), right: junk() }, buttons: { up: { key: junk(), x: junk(), y: junk(), size: junk() }, left: junk(), down: {}, right: { key: 'KeyD' } } });
    const s = C.normStore({ schema: C.SCHEMA, version: 1, activeProfileId: junk(), profiles: Array.from({ length: 3 }, () => ({ id: junk(), name: junk(), controls: Array.from({ length: 6 }, ctl) })) });
    for (const p of s.profiles) {
      const seen = new Set();
      for (const c of p.controls) {
        for (const o of c.type === 'dpad' ? Object.values(c.buttons) : [c]) {
          assert.ok(o.x >= 0 && o.x <= 1 && o.y >= 0 && o.y <= 1 && o.size >= C.LIM.minSize && o.size <= C.LIM.maxSize);
        }
        for (const sl of C.keySlots(c)) { const k = sl.get(); if (k) { assert.ok(C.assignable(k), k); assert.ok(!seen.has(k), 'phím trùng ' + k); seen.add(k); } }
      }
    }
    assert.ok(s.profiles.length >= 1 && s.profiles.some(p => p.id === s.activeProfileId));
  }
});

/* ───────────── Phím ───────────── */
test('key labels', () => {
  assert.deepEqual(['KeyW', 'Digit3', 'Space', 'ArrowUp', 'Numpad5', 'F5', 'ShiftLeft', 'Weird'].map(C.keyLabel), ['W', '3', 'Space', '↑', 'Num 5', 'F5', 'L-Shift', 'Weird']);
  assert.equal(C.keyLabel(''), '');
});

test('assignKey: conflicts, reserved keys, unassign, re-assign to the same slot', () => {
  const p = C.defaultProfile('t');
  const j = C.makeControl('joystick'), b = C.makeControl('button', { name: 'Fire' });
  p.controls.push(j, b);
  assert.equal(C.assignKey(p, b.id, '', 'KeyW').reason, 'used');                       // W đang là phím lên của joystick
  assert.equal(C.assignKey(p, b.id, '', 'KeyW').by.control.id, j.id);
  assert.equal(C.assignKey(p, b.id, '', 'F11').reason, 'reserved');
  assert.equal(C.assignKey(p, b.id, '', 'Escape').reason, 'reserved');
  assert.equal(C.assignKey(p, b.id, '', 'bad key!').reason, 'invalid');
  assert.equal(C.assignKey(p, 'nope', '', 'KeyQ').reason, 'invalid');
  assert.equal(C.assignKey(p, b.id, 'zzz', 'KeyQ').reason, 'invalid');
  assert.ok(C.assignKey(p, b.id, '', 'Space').ok); assert.equal(b.key, 'Space');
  assert.ok(C.assignKey(p, b.id, '', 'Space').ok, 'gán lại đúng phím của chính ô đó thì được');
  assert.ok(C.assignKey(p, j.id, 'up', 'ArrowUp').ok); assert.equal(j.keys.up, 'ArrowUp');
  assert.ok(C.assignKey(p, b.id, '', 'KeyW').ok, 'W đã được nhả ra nên gán được');
  assert.ok(C.assignKey(p, b.id, '', '').ok); assert.equal(b.key, '');
});

/* ───────────── Profile ───────────── */
test('profile management: add / rename / duplicate / delete / unique names', () => {
  const s = C.defaultStore();
  const a = C.addProfile(s, 'Game'); const b = C.addProfile(s, 'Game');
  assert.deepEqual([a.name, b.name], ['Game', 'Game (2)']);
  assert.equal(s.activeProfileId, b.id);
  C.renameProfile(s, a.id, '  Liên Quân ⚔  '); assert.equal(a.name, 'Liên Quân ⚔');
  C.renameProfile(s, a.id, '   '); assert.equal(a.name, 'Liên Quân ⚔', 'tên rỗng bị bỏ qua');
  a.controls.push(C.makeControl('button', { key: 'KeyQ' }));
  const d = C.duplicateProfile(s, a.id);
  assert.notEqual(d.id, a.id); assert.notEqual(d.controls[0].id, a.controls[0].id);
  assert.equal(d.controls[0].key, 'KeyQ'); assert.equal(d.name, 'Liên Quân ⚔ copy');
  assert.equal(s.profiles[s.profiles.indexOf(a) + 1], d, 'bản sao nằm ngay sau bản gốc');
  C.deleteProfile(s, d.id); assert.ok(!s.profiles.includes(d)); assert.ok(s.profiles.some(p => p.id === s.activeProfileId));
  const only = C.defaultStore(); C.deleteProfile(only, only.profiles[0].id);
  assert.equal(only.profiles.length, 1, 'xoá hết thì tạo lại profile trống'); assert.equal(only.activeProfileId, only.profiles[0].id);
});

test('profiles per game, most recently used first', () => {
  const s = C.defaultStore();
  const a = C.addProfile(s, 'Solo'), b = C.addProfile(s, 'Squad'), c = C.addProfile(s, 'Other');
  a.game = { package: 'com.x.y', label: 'X' }; b.game = { package: 'com.x.y', label: 'X' }; c.game = { package: 'com.z.w', label: 'Z' };
  a.lastUsedAt = 5; b.lastUsedAt = 9;
  assert.deepEqual(C.profilesForGame(s, 'com.x.y').map(p => p.name), ['Squad', 'Solo']);
  assert.deepEqual(C.profilesForGame(s, 'nope'), []);
  assert.deepEqual(C.profilesForGame(s, ''), []);
});

/* ───────────── Import / Export ───────────── */
test('export → import round trip (single profile and whole store) with fresh ids', () => {
  const s = C.defaultStore(); const p = s.profiles[0];
  p.name = 'PUBG'; p.game = { package: 'com.tencent.ig', label: 'PUBG Mobile' };
  p.controls.push(C.makeControl('joystick', { x: .2, y: .7 }), C.makeControl('dpad', { x: .8, y: .6 }), C.makeControl('button', { x: .9, y: .3, key: 'Space', name: 'Jump' }));
  const one = C.parseImport(C.exportProfile(p));
  assert.equal(one.length, 1); assert.notEqual(one[0].id, p.id);
  assert.deepEqual(one[0].controls.map(c => c.type), ['joystick', 'dpad', 'button']);
  assert.notEqual(one[0].controls[0].id, p.controls[0].id);
  assert.equal(one[0].game.package, 'com.tencent.ig'); assert.equal(one[0].controls[2].key, 'Space');
  const all = C.parseImport(C.exportAll(s)); assert.equal(all.length, 1);
  // import vào store đã có: không đè, tên không trùng, chọn profile mới nhập
  const before = s.profiles.length;
  assert.equal(C.importProfiles(s, one), 1);
  assert.equal(s.profiles.length, before + 1); assert.equal(s.profiles[before].name, 'PUBG (2)'); assert.equal(s.activeProfileId, s.profiles[before].id);
});

test('import rejects garbage with clear errors', () => {
  assert.throws(() => C.parseImport('nope'), /Invalid JSON/);
  assert.throws(() => C.parseImport('{"schema":"x"}'), /Not a LUMIR/);
  assert.throws(() => C.parseImport('null'), /Not a LUMIR/);
  assert.throws(() => C.parseImport(JSON.stringify({ schema: C.SCHEMA, version: 1, profiles: [] })), /No profiles/);
});

/* ───────────── Engine ───────────── */
function rig(profile, geom = { w: 540, h: 1200 }) {
  const log = []; const clock = { t: 0 };
  const e = new C.Engine({ send: (p, ph, x, y) => log.push({ p, ph, x, y, t: clock.t }), geom: () => geom, now: () => clock.t, onExhausted: () => log.push({ exhausted: true }) });
  e.setProfile(profile);
  const adv = (ms, step = 16) => { for (let i = 0; i < ms; i += step) { clock.t += Math.min(step, ms - i); e.update(clock.t); } };
  return { e, log, clock, adv, geom };
}
const prof = (...controls) => { const p = C.defaultProfile('t'); p.controls.push(...controls); return p; };
const phases = (log, ph) => log.filter(l => l.ph === ph);

test('button: press = down at its position, hold = no spam, release = up (after the minimum hold)', () => {
  const b = C.makeControl('button', { x: .8, y: .3, key: 'Space' });
  const { e, log, adv, clock } = rig(prof(b));
  assert.equal(e.keyDown('Space'), true);
  assert.deepEqual(log, [{ p: 0, ph: 'down', x: .8, y: .3, t: 0 }]);
  adv(500); e.keyDown('Space'); e.keyDown('Space');                    // tự lặp phím của hệ điều hành
  assert.equal(log.length, 1, 'giữ phím không sinh thêm sự kiện');
  assert.equal(e.keyUp('Space'), true);
  assert.deepEqual(log[1], { p: 0, ph: 'up', x: .8, y: .3, t: clock.t });
  assert.equal(e.keyDown('KeyZ'), false, 'phím chưa gán không bị nuốt');
  assert.equal(e.keyUp('KeyZ'), false);
});

test('a very fast tap is held for MIN_HOLD so the game registers it', () => {
  const { e, log, adv, clock } = rig(prof(C.makeControl('button', { key: 'KeyQ' })));
  e.keyDown('KeyQ'); clock.t += 5; e.keyUp('KeyQ');
  assert.equal(phases(log, 'up').length, 0, 'chưa nhả vì chưa đủ thời gian giữ');
  adv(60);
  const up = phases(log, 'up')[0]; assert.ok(up); assert.ok(up.t >= C.MIN_HOLD, `nhả lúc ${up.t}ms`);
});

test('two buttons held at once = two different fingers; each released independently', () => {
  const { e, log, adv } = rig(prof(C.makeControl('button', { x: .1, y: .1, key: 'KeyQ' }), C.makeControl('button', { x: .9, y: .9, key: 'KeyE' })));
  e.keyDown('KeyQ'); e.keyDown('KeyE');
  assert.deepEqual(phases(log, 'down').map(l => l.p), [0, 1]);
  adv(100); e.keyUp('KeyQ'); assert.deepEqual(phases(log, 'up').map(l => l.p), [0], 'chỉ ngón của Q được nhấc');
  assert.equal(e.activeCount, 1);
  adv(100); e.keyUp('KeyE'); assert.equal(e.activeCount, 0);
});

test('directional joystick: W+D together = two fingers on two separate buttons (diagonal)', () => {
  const dp = C.makeControl('dpad', { x: .2, y: .7 });
  const { e, log, adv } = rig(prof(dp));
  e.keyDown('KeyW'); e.keyDown('KeyD'); adv(100);
  const d = phases(log, 'down');
  assert.equal(d.length, 2); assert.notEqual(d[0].p, d[1].p);
  assert.deepEqual([d[0].x, d[0].y], [dp.buttons.up.x, dp.buttons.up.y]);
  assert.deepEqual([d[1].x, d[1].y], [dp.buttons.right.x, dp.buttons.right.y]);
  e.keyUp('KeyW'); adv(100); e.keyUp('KeyD'); adv(100);
  assert.equal(e.activeCount, 0);
  assert.equal(phases(log, 'up').length, 2);
});

test('each D-pad button can sit anywhere independently', () => {
  const dp = C.makeControl('dpad', { x: .5, y: .5 });
  dp.buttons.left.x = .05; dp.buttons.left.y = .95;
  const { e, log } = rig(prof(dp));
  e.keyDown('KeyA');
  assert.deepEqual([log[0].x, log[0].y], [.05, .95]);
});

test('circular joystick: down at the centre, then slides to the held direction (8 directions)', () => {
  const j = C.makeControl('joystick', { x: .25, y: .75, size: .3 });
  const { e, log, adv, geom } = rig(prof(j), { w: 540, h: 1200 });
  const R = j.size * Math.min(geom.w, geom.h) / 2;                   // = 81px
  e.keyDown('KeyW'); adv(400);
  assert.deepEqual([log[0].ph, log[0].x, log[0].y], ['down', .25, .75]);
  const last = log[log.length - 1];
  assert.equal(last.ph, 'move'); near(last.x, .25); near(last.y, .75 - R / geom.h, 1e-3);
  // 8 hướng: mỗi tổ hợp phím cho đúng vector, độ lớn luôn = 1 (chéo không nhanh hơn)
  const cases = { KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0], 'KeyW+KeyD': [1, -1], 'KeyW+KeyA': [-1, -1], 'KeyS+KeyD': [1, 1], 'KeyS+KeyA': [-1, 1] };
  for (const [combo, [dx, dy]] of Object.entries(cases)) {
    const r = rig(prof(C.makeControl('joystick', { x: .5, y: .5, size: .3 })));
    combo.split('+').forEach(k => r.e.keyDown(k)); r.adv(500);
    const m = r.log[r.log.length - 1], n = Math.hypot(dx, dy);
    near((m.x - .5) * r.geom.w, dx / n * R, 0.2); near((m.y - .5) * r.geom.h, dy / n * R, 0.2);
  }
});

test('joystick: opposite keys cancel; direction changes slide continuously on the SAME finger', () => {
  const j = C.makeControl('joystick', { x: .5, y: .5, size: .3 });
  const { e, log, adv } = rig(prof(j));
  e.keyDown('KeyA'); e.keyDown('KeyD'); adv(300);
  const m = log[log.length - 1]; near(m.x, .5, 1e-3); near(m.y, .5, 1e-3);   // A+D = đứng yên
  e.keyUp('KeyA'); adv(300); e.keyDown('KeyW'); adv(300); e.keyUp('KeyD'); adv(300);
  assert.equal(phases(log, 'down').length, 1, 'đổi hướng không nhấc ngón');
  assert.equal(new Set(log.map(l => l.p)).size, 1);
  for (let i = 1; i < log.length; i++) if (log[i].ph === 'move') assert.ok(Math.hypot((log[i].x - log[i - 1].x) * 540, (log[i].y - log[i - 1].y) * 1200) < 40, 'không giật nhảy giữa hai khung');
  e.keyUp('KeyW'); adv(100);
  assert.equal(phases(log, 'up').length, 1); assert.equal(e.activeCount, 0);
});

test('a quick tap on the joystick still nudges the character (not a motionless touch at the centre)', () => {
  const { e, log, adv, clock } = rig(prof(C.makeControl('joystick', { x: .5, y: .5, size: .3 })));
  e.keyDown('KeyW'); clock.t += 8; e.keyUp('KeyW'); adv(100);
  const up = phases(log, 'up')[0]; assert.ok(up);
  assert.ok(phases(log, 'move').length >= 1, 'có di chuyển'); assert.ok(up.y < .5 - 0.01, `up.y=${up.y}`);
});

test('joystick geometry uses the SHORT side, so landscape is still a circle', () => {
  const j = C.makeControl('joystick', { x: .2, y: .6, size: .4 });
  const { e, log, adv } = rig(prof(j), { w: 2400, h: 1080 });
  e.keyDown('KeyD'); adv(500);
  const m = log[log.length - 1], R = .4 * 1080 / 2;
  near((m.x - .2) * 2400, R, 0.3); near(m.y, .6, 1e-6);
});

test('no spurious move events while nothing changes', () => {
  const { e, log, adv } = rig(prof(C.makeControl('joystick', { x: .5, y: .5, size: .3 })));
  e.keyDown('KeyW'); adv(1000); const n = log.length; adv(2000);
  assert.equal(log.length, n);
});

test('releaseAll lifts every finger immediately; later key-ups send nothing', () => {
  const { e, log, adv } = rig(prof(C.makeControl('joystick', { x: .3, y: .7 }), C.makeControl('button', { key: 'Space' }), C.makeControl('button', { key: 'KeyQ', x: .6 })));
  e.keyDown('KeyW'); e.keyDown('Space'); e.keyDown('KeyQ'); adv(100);
  assert.equal(e.activeCount, 3);
  e.releaseAll();
  assert.equal(phases(log, 'up').length, 3); assert.equal(e.activeCount, 0);
  const n = log.length; e.keyUp('KeyW'); e.keyUp('Space'); adv(300);
  assert.equal(log.length, n, 'thả phím sau khi đã nhả hết không gửi thêm gì');
});

test('changing profile releases everything held', () => {
  const { e, log } = rig(prof(C.makeControl('button', { key: 'Space' })));
  e.keyDown('Space'); e.setProfile(prof(C.makeControl('button', { key: 'KeyQ' })));
  assert.equal(phases(log, 'up').length, 1); assert.equal(e.has('Space'), false); assert.equal(e.has('KeyQ'), true);
});

test('reset() forgets state without sending anything (dead control channel)', () => {
  const { e, log } = rig(prof(C.makeControl('button', { key: 'Space' })));
  e.keyDown('Space'); const n = log.length; e.reset();
  assert.equal(log.length, n); assert.equal(e.activeCount, 0);
  e.keyDown('Space'); assert.equal(phases(log, 'down').length, 2, 'dùng lại được sau reset');
});

test('at most 9 fingers at once; the 10th press is ignored and frees up later', () => {
  const ctl = Array.from({ length: 12 }, (_, i) => C.makeControl('button', { x: (i + 1) / 13, key: 'Digit' + (i % 10) + (i >= 10 ? 'x' : '') }));
  const { e, log, adv } = rig(prof(...ctl));
  const keys = ctl.map(c => c.key);
  keys.forEach(k => e.keyDown(k)); adv(100);
  assert.equal(phases(log, 'down').length, C.MAX_POINTERS);
  assert.ok(log.some(l => l.exhausted));
  assert.ok(Math.max(...phases(log, 'down').map(l => l.p)) < C.MAX_POINTERS);
  e.keyUp(keys[0]); adv(100);
  e.keyDown(keys[11]); assert.equal(phases(log, 'down').length, C.MAX_POINTERS + 1, 'ngón vừa nhả được dùng lại');
  assert.equal(phases(log, 'down').at(-1).p, 0);
});

test('INVARIANT (fuzz): downs and ups always balance, no stray move/up, never >9 fingers, no double down', () => {
  const rnd = (n) => Math.floor(Math.random() * n);
  const KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'KeyJ', 'KeyK', 'KeyL', 'KeyU', 'KeyI', 'KeyO'];
  for (let round = 0; round < 200; round++) {
    const p = C.defaultProfile('f');
    p.controls.push(C.makeControl('joystick', { x: .2, y: .7, keys: { up: 'KeyW', left: 'KeyA', down: 'KeyS', right: 'KeyD' } }));
    p.controls.push(C.makeControl('dpad', { x: .8, y: .7, keys: { up: 'ArrowUp', left: 'ArrowLeft', down: 'ArrowDown', right: 'ArrowRight' } }));
    ['Space', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyJ', 'KeyK', 'KeyL', 'KeyU', 'KeyI', 'KeyO'].forEach((k, i) => p.controls.push(C.makeControl('button', { x: (i + 1) / 12, y: .3, key: k })));
    const down = new Set(), errs = []; let clock = 0;
    const e = new C.Engine({
      geom: () => ({ w: 540, h: 1200 }), now: () => clock,
      send: (ptr, ph, x, y) => {
        if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) errs.push('toạ độ ngoài 0..1');
        if (ph === 'down') { if (down.has(ptr)) errs.push('double down ' + ptr); down.add(ptr); if (down.size > C.MAX_POINTERS) errs.push('>9 ngón'); }
        else { if (!down.has(ptr)) errs.push(`${ph} cho ngón chưa chạm ${ptr}`); if (ph === 'up') down.delete(ptr); }
      }
    });
    e.setProfile(p);
    for (let step = 0; step < 150; step++) {
      clock += rnd(40);
      const r = rnd(10);
      if (r < 4) e.keyDown(KEYS[rnd(KEYS.length)]); else if (r < 8) e.keyUp(KEYS[rnd(KEYS.length)]); else if (r === 8) e.update(clock);
      else if (rnd(12) === 0) e.releaseAll();
      if (rnd(40) === 0) e.setProfile(p);
    }
    e.releaseAll();
    assert.deepEqual(errs, [], 'vòng ' + round);
    assert.equal(down.size, 0, 'còn ngón chưa nhấc ở vòng ' + round);
    assert.equal(e.activeCount, 0);
  }
});
