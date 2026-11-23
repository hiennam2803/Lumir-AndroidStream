// E2E: chạy src/phone.html trong Chromium thật với mock Tauri (ghi lại mọi invoke). Chạy: node tests/e2e-keymap.mjs
// Cần: playwright (npm i -D playwright && npx playwright install chromium). Biến PW_MODULE trỏ tới module nếu cài toàn cục.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import assert from 'node:assert/strict';
import { createRequire } from 'node:module'; import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE || 'playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const shots = process.env.SHOTS || '';

const srv = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end(); }
  const t = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(f)] || 'application/octet-stream';
  r.writeHead(200, { 'content-type': t }); fs.createReadStream(f).pipe(r);
}).listen(0);
const URL_ = `http://127.0.0.1:${srv.address().port}/phone.html`;

const MOCK = () => {
  const L = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } };
  window.__calls = []; window.__fg = '';
  window.__TAURI__ = {
    core: {
      Channel: class { set onmessage(_) {} },
      invoke: async (cmd, args) => {
        window.__calls.push({ cmd, args: JSON.parse(JSON.stringify(args || {})) });
        switch (cmd) {
          case 'phone_context': return { serial: 'TEST1', device: { status: 'connected', name: 'Test Phone', resolution: '1080×2400', serial: 'TEST1' } };
          case 'keymap_load': return localStorage.getItem('mock-disk') || '';
          case 'keymap_save': { const o = JSON.parse(args.json); if (o.schema !== 'lumir.keymap') throw 'Not a LUMIR key mapping file'; localStorage.setItem('mock-disk', args.json); return null; }
          case 'keymap_export': return '/home/user/Downloads/' + args.name + '.json';
          case 'foreground_app': return window.__fg;
          case 'touch_release_all': return 0;
          case 'touch_pointer': if (window.__failTouch) throw 'Key mapping needs the scrcpy control channel, which is still starting. Try again in a moment.'; return null;
          default: return null;
        }
      }
    },
    window: { getCurrentWindow: () => ({ label: 'phone-test', minimize() {}, close() {}, startDragging: async () => {}, onResized: async () => () => {} }) },
    event: { listen: async (n, cb) => { (window.__ev = window.__ev || {})[n] = cb; return () => {}; } }
  };
};

let pass = 0, fail = 0; const fails = [];
async function t(name, fn) { try { await fn(); pass++; console.log('  ✓', name); } catch (e) { fail++; fails.push(name); console.log('  ✗', name, '\n     ', String(e.message || e).split('\n').slice(0, 6).join('\n      ')); } }

const browser = await chromium.launch({ args: ['--no-sandbox'] });
async function open(opts = {}) {
  const ctx = opts.ctx || await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => { throw e; });
  const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.__errs = errs;
  await page.addInitScript(MOCK);
  await page.goto(URL_); await page.bringToFront();
  await page.waitForFunction(() => window.LumirKeymap && document.querySelector('#phNm').textContent === 'Test Phone');
  await page.waitForTimeout(150);
  return page;
}
const calls = (p, cmd) => p.evaluate(c => window.__calls.filter(x => x.cmd === c).map(x => x.args), cmd);
const clear = p => p.evaluate(() => { window.__calls.length = 0; });
const disk = p => p.evaluate(() => JSON.parse(localStorage.getItem('mock-disk') || 'null'));
const mode = p => p.evaluate(() => window.LumirKeymap.mode);
const toastText = p => p.evaluate(() => document.querySelector('#toast').textContent);
const box = async (p, sel) => (await p.locator(sel).first().boundingBox());
const centre = async (p, sel) => { const b = await box(p, sel); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const MAP = '.rb[data-t=map]', KBD = '.rb[data-t=kbd]';
const addCtl = async (p, type) => p.click(`[data-act=add][data-t=${type}]`);
const press = async (p, k, ms = 120) => { await p.keyboard.down(k); await p.waitForTimeout(ms); await p.keyboard.up(k); };

console.log('Game Key Mapping — E2E (Chromium + mock Tauri)\n');
const page = await open();

await t('rail: Chat keyboard and Game Key Mapping are separate buttons with distinct icons and labels', async () => {
  const kbd = await page.$eval(KBD, e => ({ l: e.dataset.l, lines: e.querySelectorAll('line').length, rect: e.querySelectorAll('rect').length }));
  const map = await page.$eval(MAP, e => ({ l: e.dataset.l, lines: e.querySelectorAll('line').length, rect: e.querySelectorAll('rect').length }));
  assert.equal(kbd.l, 'Chat keyboard'); assert.equal(map.l, 'Game Key Mapping');
  assert.equal(map.lines, 4, 'gamepad-2 có 4 đoạn thẳng (d-pad + 2 nút)'); assert.equal(kbd.lines, 0); assert.equal(kbd.rect, 1, 'keyboard = 1 hình chữ nhật');
});

await t('clicking Game Key Mapping opens edit mode: movable panel + ~25% black overlay, game still visible', async () => {
  await page.click(MAP); await page.waitForSelector('#gkPanel.on'); await page.waitForTimeout(300);
  assert.equal(await mode(page), 'edit');
  const bg = await page.$eval('.gk-shade', e => getComputedStyle(e).backgroundColor); assert.equal(bg, 'rgba(0, 0, 0, 0.25)');
  assert.equal(await page.$eval('.gk-shade', e => getComputedStyle(e).opacity), '1');
  assert.equal(await page.$$eval('#gkPanel [data-act=save], #gkPanel [data-act=done], #gkPanel [data-act=cancel]', a => a.length), 3, 'có Save, Done, Cancel');
  assert.equal(await page.$$eval('#gkPanel [data-act=add]', a => a.map(b => b.dataset.t).join()), 'joystick,dpad,button');
  assert.equal(await page.$eval('.rb[data-t=map]', e => e.classList.contains('on')), true);
  if (shots) await page.screenshot({ path: shots + '/01-edit-empty.png' });
});

await t('overlay lives INSIDE the phone frame and is sized to it (controls track the stream)', async () => {
  const ph = await box(page, '#vid'), gk = await box(page, '#gk');
  for (const k of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(ph[k] - gk[k]) < 1.5, `${k}: ${ph[k]} vs ${gk[k]}`);
});

await t('add Circular Joystick, Directional Joystick, Custom Button → appear on the screen', async () => {
  await addCtl(page, 'joystick'); await addCtl(page, 'dpad'); await addCtl(page, 'button');
  assert.equal(await page.$$eval('.gk-joy', a => a.length), 1);
  assert.equal(await page.$$eval('.gk-dp', a => a.length), 4, 'D-pad = 4 nút riêng');
  assert.equal(await page.$$eval('.gk-tap', a => a.length), 1);
  const joyKeys = await page.$$eval('.gk-joy .gk-jk', a => a.map(e => e.textContent).join(''));
  assert.equal(joyKeys.split('').sort().join(''), 'ADSW');
  // D-pad thêm sau joystick: WASD đã bị chiếm → để trống, không gán trùng
  assert.equal(await page.$$eval('.gk-dp .gk-kl', a => a.every(e => e.classList.contains('none'))), true);
  if (shots) await page.screenshot({ path: shots + '/02-edit-controls.png' });
});

await t('drag a control on the phone screen → position changes, stays inside 0..1', async () => {
  const el = '.gk-tap'; const c0 = await centre(page, el);
  await page.mouse.move(c0.x, c0.y); await page.mouse.down(); await page.mouse.move(c0.x - 60, c0.y - 80, { steps: 6 }); await page.mouse.up();
  const c1 = await centre(page, el);
  assert.ok(Math.abs(c1.x - (c0.x - 60)) < 3 && Math.abs(c1.y - (c0.y - 80)) < 3, `${JSON.stringify(c0)} → ${JSON.stringify(c1)}`);
  // kéo ra ngoài khung → bị kẹp trong 0..1
  await page.mouse.move(c1.x, c1.y); await page.mouse.down(); await page.mouse.move(-500, -500, { steps: 4 }); await page.mouse.up();
  const ph = await box(page, '#vid'), c2 = await centre(page, el);
  assert.ok(Math.abs(c2.x - ph.x) < 2 && Math.abs(c2.y - ph.y) < 2, 'kẹp ở góc trên-trái của khung');
  // kéo lại vào giữa-phải cho các bước sau
  await page.mouse.move(c2.x, c2.y); await page.mouse.down(); await page.mouse.move(ph.x + ph.width * .8, ph.y + ph.height * .5, { steps: 5 }); await page.mouse.up();
  assert.equal(await page.$eval('.gk-tap', e => e.classList.contains('sel')), true, 'kéo cũng là chọn');
});

await t('resize via the handle (size tracks the pointer distance, clamped)', async () => {
  const s0 = await page.$eval('.gk-tap', e => parseFloat(e.style.getPropertyValue('--sz')));
  const rz = await centre(page, '.gk-tap.sel .gk-rz'); const cc = await centre(page, '.gk-tap');
  await page.mouse.move(rz.x, rz.y); await page.mouse.down(); await page.mouse.move(rz.x + 40, rz.y + 40, { steps: 5 }); await page.mouse.up();
  const s1 = await page.$eval('.gk-tap', e => parseFloat(e.style.getPropertyValue('--sz'))); assert.ok(s1 > s0 + .05, `${s0} → ${s1}`);
  const rz2 = await centre(page, '.gk-tap.sel .gk-rz'); await page.mouse.move(rz2.x, rz2.y); await page.mouse.down(); await page.mouse.move(cc.x, cc.y, { steps: 5 }); await page.mouse.up();
  assert.equal(await page.$eval('.gk-tap', e => parseFloat(e.style.getPropertyValue('--sz'))), 0.04, 'kích thước tối thiểu');
  await page.fill('#gkProps [data-f=size]', '12'); // thanh trượt trong bảng
  assert.equal(await page.$eval('.gk-tap', e => parseFloat(e.style.getPropertyValue('--sz'))), 0.12);
});

await t('assign a key to the custom button; conflicts / reserved / escape handled', async () => {
  await page.click('#gkProps [data-act=key]'); assert.match(await page.$eval('#gkProps .gk-chip', e => e.textContent), /Press a key/);
  await page.keyboard.press('KeyW'); assert.match(await toastText(page), /Key already used by/);
  await page.keyboard.press('F11'); assert.match(await toastText(page), /reserved/);
  assert.equal(await page.evaluate(() => !!document.documentElement.classList.contains('is-fullscreen')), false, 'F11 không bị nuốt thành toàn màn hình khi đang gán');
  await page.keyboard.press('Escape'); assert.doesNotMatch(await page.$eval('#gkProps .gk-chip', e => e.textContent), /Press a key/);
  await page.click('#gkProps [data-act=key]'); await page.keyboard.press('Space');
  assert.equal(await page.$eval('.gk-tap .gk-kl', e => e.textContent), 'Space');
  await page.fill('#gkProps [data-f=name]', 'Jump'); assert.equal(await page.$eval('.gk-tap .gk-nm', e => e.textContent), 'Jump');
});

await t('rebind a joystick direction; each D-pad button gets its own key and can be moved independently', async () => {
  await page.click('.gk-li:has-text("Move")'); await page.click('#gkProps [data-slot=up]'); await page.keyboard.press('ArrowUp');
  assert.equal(await page.$$eval('.gk-joy .gk-jk', a => a.map(e => e.textContent).join('')).then(s => s.includes('↑')), true);
  await page.click('.gk-li:has-text("D-pad")');
  const keys = ['up:KeyI', 'left:KeyJ', 'down:KeyK', 'right:KeyL'];
  for (const k of keys) { const [slot, code] = k.split(':'); await page.click(`#gkProps [data-slot=${slot}]`); await page.keyboard.press(code); }
  assert.deepEqual(await page.$$eval('.gk-dp .gk-kl', a => a.map(e => e.textContent)), ['I', 'J', 'K', 'L']);
  const before = await centre(page, '.gk-dp[data-slot=left]'), other = await centre(page, '.gk-dp[data-slot=right]');
  await page.mouse.move(before.x, before.y); await page.mouse.down(); await page.mouse.move(before.x - 10, before.y - 90, { steps: 5 }); await page.mouse.up();
  const after = await centre(page, '.gk-dp[data-slot=left]'), other2 = await centre(page, '.gk-dp[data-slot=right]');
  assert.ok(Math.abs(after.y - (before.y - 90)) < 3); assert.deepEqual(other, other2, 'nút khác đứng yên');
  if (shots) await page.screenshot({ path: shots + '/03-edit-configured.png' });
});

await t('the tool panel can be dragged and stays inside the window', async () => {
  const h = await centre(page, '.gk-ph'); const p0 = await box(page, '#gkPanel');
  await page.mouse.move(h.x - 60, h.y); await page.mouse.down(); await page.mouse.move(h.x - 160, h.y + 120, { steps: 6 });
  await page.mouse.up(); const p1 = await box(page, '#gkPanel');
  assert.ok(p1.x < p0.x - 50 && p1.y > p0.y + 50, `${p0.x},${p0.y} → ${p1.x},${p1.y}`);
  const h2 = await centre(page, '.gk-ph'); await page.mouse.move(h2.x - 40, h2.y); await page.mouse.down(); await page.mouse.move(-900, 5000, { steps: 4 }); await page.mouse.up();
  const p2 = await box(page, '#gkPanel'); assert.ok(p2.x >= 0 && p2.y >= 0 && p2.x + p2.width <= 1001 && p2.y + p2.height <= 901, JSON.stringify(p2));
  await page.click('[data-act=collapse]'); assert.ok((await box(page, '#gkPanel')).height < 60, 'thu gọn'); await page.click('[data-act=collapse]');
});

await t('delete a control (panel button and Delete key)', async () => {
  const n0 = await page.$$eval('.gk-li', a => a.length);
  await page.click('.gk-li:has-text("D-pad")'); await page.click('#gkProps [data-act=rm]');
  assert.equal(await page.$$eval('.gk-li', a => a.length), n0 - 1); assert.equal(await page.$$eval('.gk-dp', a => a.length), 0);
  await page.click('.gk-li:has-text("Jump")'); await page.keyboard.press('Delete');
  assert.equal(await page.$$eval('.gk-tap', a => a.length), 0);
  // thêm lại nút để dùng ở bước chơi
  await addCtl(page, 'button'); await page.click('#gkProps [data-act=key]'); await page.keyboard.press('Space');
  await page.fill('#gkProps [data-f=x]', '80'); await page.fill('#gkProps [data-f=y]', '50'); await page.fill('#gkProps [data-f=name]', 'Fire');
});

await t('Save writes JSON with normalised coordinates; Cancel discards unsaved edits (two-step confirm)', async () => {
  assert.equal(await disk(page), null, 'chưa Save thì chưa ghi');
  assert.equal(await page.$eval('[data-act=save]', e => e.disabled), false);
  await page.fill('#gkName', 'My Game'); await page.click('[data-act=save]'); await page.waitForTimeout(100);
  const d = await disk(page); assert.equal(d.schema, 'lumir.keymap'); const p = d.profiles.find(x => x.name === 'My Game'); assert.ok(p);
  assert.equal(p.platform.os, 'android'); assert.equal(p.platform.resolution, '1080×2400'); assert.equal(p.platform.orientation, 'portrait');
  const fire = p.controls.find(c => c.name === 'Fire'); assert.deepEqual([fire.x, fire.y, fire.key, fire.type], [0.8, 0.5, 'Space', 'button']);
  for (const c of p.controls) for (const o of c.type === 'dpad' ? Object.values(c.buttons) : [c]) assert.ok(o.x >= 0 && o.x <= 1 && o.y >= 0 && o.y <= 1);
  assert.equal(await page.$eval('[data-act=save]', e => e.disabled), true, 'sạch thì Save bị khoá');
  await page.fill('#gkName', 'Oops'); await page.click('[data-act=cancel]');
  assert.equal(await mode(page), 'edit', 'lần bấm đầu chỉ xin xác nhận'); assert.match(await page.$eval('[data-act=cancel]', e => e.textContent), /discard/);
  await page.click('[data-act=cancel]'); await page.waitForTimeout(350);
  assert.equal(await mode(page), 'off'); assert.equal((await disk(page)).profiles.find(x => x.name === 'Oops'), undefined);
  assert.equal(await page.$eval('.rb[data-t=map]', e => e.classList.contains('on')), false);
  assert.equal(await page.$eval('#gkPanel', e => e.hidden), true);
});

await t('profiles: new, rename, duplicate, delete, switch; per-profile controls', async () => {
  await page.click(MAP); await page.waitForSelector('#gkPanel.on');
  assert.equal(await page.$eval('#gkName', e => e.value), 'My Game');
  await page.click('[data-act=newp]'); assert.equal(await page.$$eval('#gkProf option', a => a.length), 2);
  assert.equal(await page.$$eval('.gk-li', a => a.length), 0, 'profile mới trống'); assert.equal(await page.$$eval('.gk-c', a => a.length), 0);
  await page.fill('#gkName', 'Blank'); assert.match(await page.$eval('#gkProf option:checked', e => e.textContent), /Blank/);
  await page.selectOption('#gkProf', { label: 'My Game' }); assert.ok(await page.$$eval('.gk-c', a => a.length) >= 2, 'đổi profile → nạp lại nút');
  await page.click('[data-act=menu]'); await page.click('[data-act=dup]');
  assert.equal(await page.$eval('#gkName', e => e.value), 'My Game copy'); assert.equal(await page.$$eval('#gkProf option', a => a.length), 3);
  assert.ok(await page.$$eval('.gk-c', a => a.length) >= 2, 'bản sao giữ nút');
  await page.click('[data-act=menu]'); await page.click('[data-act=delp]'); assert.equal(await page.$$eval('#gkProf option', a => a.length), 3, 'xoá cần bấm 2 lần');
  await page.click('[data-act=delp]'); assert.equal(await page.$$eval('#gkProf option', a => a.length), 2);
});

await t('export gives valid JSON; importing it back adds a profile with fresh ids (and rejects junk)', async () => {
  await page.selectOption('#gkProf', { label: 'My Game' }); await clear(page);
  await page.click('[data-act=menu]'); await page.click('[data-act=exp]'); await page.waitForTimeout(100);
  const ex = (await calls(page, 'keymap_export'))[0]; assert.ok(ex); assert.match(ex.name, /My Game/);
  const parsed = JSON.parse(ex.json); assert.equal(parsed.schema, 'lumir.keymap.profile'); assert.equal(parsed.profile.name, 'My Game');
  assert.match(await toastText(page), /Exported to .*My Game/);
  await page.setInputFiles('input[type=file]', { name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(ex.json) });
  await page.waitForTimeout(200); assert.match(await toastText(page), /Imported 1/);
  assert.equal(await page.$$eval('#gkProf option', a => a.length), 3); assert.equal(await page.$eval('#gkName', e => e.value), 'My Game (2)');
  await page.setInputFiles('input[type=file]', { name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await page.waitForTimeout(200); assert.match(await toastText(page), /Not a LUMIR/); assert.equal(await page.$$eval('#gkProf option', a => a.length), 3);
  await page.selectOption('#gkProf', { label: 'My Game' });
});

await t('profile ↔ game: detect running game, and auto-select the matching profile next time', async () => {
  await page.evaluate(() => { window.__fg = 'com.tencent.ig'; });
  await page.click('[data-act=detect]'); await page.waitForTimeout(100);
  assert.equal(await page.$eval('#gkGame', e => e.value), 'Ig'); assert.match(await page.$eval('#gkPanel', e => e.textContent), /com\.tencent\.ig/);
  await page.fill('#gkGame', 'PUBG Mobile');
  await page.click('[data-act=done]'); await page.waitForTimeout(300);
  assert.equal((await disk(page)).profiles.find(p => p.name === 'My Game').game.package, 'com.tencent.ig');
});

await t('Done → play mode with HUD; profile picker + edit + stop; Game Key Mapping button stops it', async () => {
  assert.equal(await mode(page), 'play'); assert.equal(await page.$eval('.gk-hud', e => getComputedStyle(e).display), 'flex');
  assert.equal(await page.$$eval('.gk-hud option', a => a.length), 3);
  assert.equal(await page.$eval('.gk[data-mode=play] .gk-c', e => parseFloat(getComputedStyle(e).opacity) <= .6), true, 'gợi ý mờ khi chơi');
  if (shots) await page.screenshot({ path: shots + '/04-play.png' });
});

await t('PLAY: keys → real multi-touch (down / move / up, distinct finger ids, normalised coords, serial)', async () => {
  await page.evaluate(() => { window.__fg = ''; }); await clear(page);
  // nút Space → chạm tại (0.8, 0.5)
  await press(page, 'Space', 150); await page.waitForTimeout(80);
  let t = await calls(page, 'touch_pointer');
  assert.deepEqual(t.map(x => x.phase), ['down', 'up']); assert.deepEqual([t[0].x, t[0].y], [0.8, 0.5]); assert.equal(t[0].serial, 'TEST1'); assert.equal(t[0].landscape, false);
  assert.ok(Number.isInteger(t[0].pointer) && t[0].pointer >= 0 && t[0].pointer < 9);
  // joystick ↑ (đã gán lại ArrowUp) + D + Space cùng lúc = 2 ngón khác nhau
  await clear(page);
  await page.keyboard.down('ArrowUp'); await page.keyboard.down('Space'); await page.waitForTimeout(350);
  t = await calls(page, 'touch_pointer');
  const downs = t.filter(x => x.phase === 'down'); assert.equal(downs.length, 2); assert.notEqual(downs[0].pointer, downs[1].pointer);
  const joyPtr = downs.find(d => d.x !== 0.8).pointer, moves = t.filter(x => x.phase === 'move' && x.pointer === joyPtr);
  assert.ok(moves.length >= 3, 'joystick trượt liên tục'); const last = moves[moves.length - 1]; assert.ok(last.y < downs.find(d => d.pointer === joyPtr).y - 0.02, 'đẩy lên');
  for (const x of t) assert.ok(x.x >= 0 && x.x <= 1 && x.y >= 0 && x.y <= 1);
  await page.keyboard.up('ArrowUp'); await page.waitForTimeout(150); await page.keyboard.up('Space'); await page.waitForTimeout(150);
  t = await calls(page, 'touch_pointer');
  for (const ptr of new Set(t.map(x => x.pointer))) { const seq = t.filter(x => x.pointer === ptr).map(x => x.phase); assert.equal(seq[0], 'down'); assert.equal(seq.at(-1), 'up'); assert.equal(seq.filter(p => p === 'down').length, 1); }
});

await t('PLAY: on-screen feedback (pressed highlight, joystick knob moves) then returns', async () => {
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(250);
  assert.equal(await page.$eval('.gk-joy', e => e.classList.contains('down')), true);
  const ky = await page.$eval('.gk-knob', e => parseFloat(e.style.getPropertyValue('--ky'))); assert.ok(ky < -0.8, 'núm lên: ' + ky);
  if (shots) await page.screenshot({ path: shots + '/05-play-pressed.png' });
  await page.keyboard.up('ArrowUp'); await page.waitForTimeout(500);
  assert.equal(await page.$eval('.gk-joy', e => e.classList.contains('down')), false);
  assert.ok(Math.abs(await page.$eval('.gk-knob', e => parseFloat(e.style.getPropertyValue('--ky')))) < .05);
});

await t('PLAY: lost focus releases every finger + asks Rust to release; later key-ups are harmless', async () => {
  await page.keyboard.down('Space'); await page.keyboard.down('ArrowUp'); await page.waitForTimeout(200); await clear(page);
  await page.evaluate(() => window.dispatchEvent(new Event('blur'))); await page.waitForTimeout(120);
  const t = await calls(page, 'touch_pointer'); assert.equal(t.filter(x => x.phase === 'up').length, 2);
  assert.equal((await calls(page, 'touch_release_all')).length >= 1, true);
  await clear(page); await page.keyboard.up('Space'); await page.keyboard.up('ArrowUp'); await page.waitForTimeout(100);
  assert.equal((await calls(page, 'touch_pointer')).length, 0);
});

await t('PLAY: hidden window and device unplug release too', async () => {
  await page.keyboard.down('Space'); await page.waitForTimeout(100); await clear(page);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(100); assert.equal((await calls(page, 'touch_pointer')).filter(x => x.phase === 'up').length, 1);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); }); await page.keyboard.up('Space');
  await page.keyboard.down('Space'); await page.waitForTimeout(80); await clear(page);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('lumir:device', { detail: { connected: false } }))); await page.waitForTimeout(350);
  assert.equal(await mode(page), 'off', 'rút cáp → thoát chế độ chơi'); assert.ok((await calls(page, 'touch_release_all')).length >= 1); await page.keyboard.up('Space');
});

await t('PLAY: stopping (rail button) releases held fingers', async () => {
  await page.click(MAP); await page.click('[data-act=done]'); await page.waitForTimeout(300); assert.equal(await mode(page), 'play');
  await page.keyboard.down('Space'); await page.waitForTimeout(100); await clear(page);
  await page.click(MAP); await page.waitForTimeout(100);
  assert.equal(await mode(page), 'off'); assert.equal((await calls(page, 'touch_pointer')).filter(x => x.phase === 'up').length, 1);
  assert.equal((await calls(page, 'touch_release_all')).length, 1); await page.keyboard.up('Space');
});

await t('after clicking the mapping button, Space/Enter do NOT re-trigger it (focus is released)', async () => {
  await page.click(MAP); await page.waitForSelector('#gkPanel.on'); await page.click('[data-act=cancel]'); await page.waitForTimeout(300);
  assert.equal(await mode(page), 'off'); await page.keyboard.press('Space'); await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  assert.equal(await mode(page), 'off');
});

await t('when OFF the mapped keys are NOT swallowed and send no touches', async () => {
  await clear(page); await press(page, 'Space', 80); await press(page, 'ArrowUp', 80);
  assert.equal((await calls(page, 'touch_pointer')).length, 0);
});

await t('INDEPENDENCE: Chat keyboard and Game mapping never run together; typing goes only to the chat path', async () => {
  await page.click(MAP); await page.waitForSelector('#gkPanel.on');
  await page.click(KBD); assert.equal(await page.evaluate(() => window.LumirPhone.kbd), false, 'đang sửa mapping thì không bật được Chat keyboard');
  assert.match(await toastText(page), /Finish editing/);
  await page.click('[data-act=done]'); await page.waitForTimeout(300); assert.equal(await mode(page), 'play');
  await page.click(KBD); await page.waitForTimeout(50);
  assert.equal(await page.evaluate(() => window.LumirPhone.kbd), true); assert.equal(await mode(page), 'off', 'bật Chat keyboard thì mapping tắt');
  await clear(page); await page.keyboard.press('ArrowUp'); await page.waitForTimeout(100);
  assert.equal((await calls(page, 'touch_pointer')).length, 0, 'phím vào chat, không thành chạm');
  assert.ok((await calls(page, 'input_key')).length >= 1);
  await page.click(KBD);   // tắt lại
});

await t('Chat keyboard untouched: its handlers/events don\'t reference the mapping module', async () => {
  const src = fs.readFileSync(path.join(root, 'scripts/phone.js'), 'utf8');
  const kbBlock = src.slice(src.indexOf('let kbd=false'), src.indexOf('/* Ánh xạ phím nằm ở'));
  assert.ok(!/LumirKeymap|touch_pointer|gk-/.test(kbBlock), 'khối Chat keyboard không đụng tới mapping');
  const km = (fs.readFileSync(path.join(root, 'scripts/keymap.js'), 'utf8') + fs.readFileSync(path.join(root, 'scripts/keymap-core.js'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/setKbd\(|kbSend|kbQ|kbIn|input_text|input_key/.test(km), 'module mapping không đụng tới Chat keyboard');
});

await t('PERSISTENCE: reload the window → profiles, controls, coordinates and key bindings are restored', async () => {
  const before = await disk(page);
  const p2 = await open({ ctx: page.context() });
  const after = await disk(p2); assert.deepEqual(after, before);
  await p2.click(MAP); await p2.waitForSelector('#gkPanel.on');
  assert.equal(await p2.$$eval('#gkProf option', a => a.length), 3); assert.equal(await p2.$eval('#gkName', e => e.value), 'My Game');
  assert.equal(await p2.$$eval('.gk-c', a => a.length), 2); assert.equal(await p2.$eval('.gk-tap .gk-kl', e => e.textContent), 'Space');
  assert.deepEqual(await p2.$eval('.gk-tap', e => [e.style.left, e.style.top]), ['80%', '50%']);
  await p2.close();
});

await t('RESOLUTION / WINDOW SIZE independent: same normalised spot at any window size; touch coords unchanged', async () => {
  const p2 = await open({ ctx: await browser.newContext({ viewport: { width: 700, height: 1000 } }) });
  await p2.evaluate(s => localStorage.setItem('mock-disk', s), JSON.stringify(await disk(page)));
  await p2.reload(); await p2.waitForFunction(() => window.LumirKeymap && document.querySelector('#phNm').textContent === 'Test Phone'); await p2.waitForTimeout(200);
  await p2.click(MAP); await p2.click('[data-act=done]'); await p2.waitForTimeout(300);
  const ph = await box(p2, '#vid'), b = await centre(p2, '.gk-tap');
  assert.ok(Math.abs((b.x - ph.x) / ph.width - 0.8) < 0.01 && Math.abs((b.y - ph.y) / ph.height - 0.5) < 0.01);
  await clear(p2); await press(p2, 'Space', 100); const t = await calls(p2, 'touch_pointer');
  assert.deepEqual([t[0].x, t[0].y], [0.8, 0.5]); await p2.context().close();
});

await t('LANDSCAPE: joystick stays circular (short-side units); touch carries landscape=true', async () => {
  const p2 = await open();
  await p2.evaluate(s => localStorage.setItem('mock-disk', s), JSON.stringify(await disk(page))); await p2.reload();
  await p2.waitForFunction(() => window.LumirKeymap && document.querySelector('#phNm').textContent === 'Test Phone'); await p2.waitForTimeout(200);
  await p2.evaluate(() => { const c = document.querySelector('#vid'); c.width = 2400; c.height = 1080; document.querySelector('#phone').style.width = '380px'; document.querySelector('#phone').style.height = '171px'; });
  await p2.waitForTimeout(150);
  await p2.click(MAP); await p2.waitForSelector('#gkPanel.on');
  const j = await box(p2, '.gk-joy'); assert.ok(Math.abs(j.width - j.height) < 1, `tròn: ${j.width}×${j.height}`);
  await p2.click('[data-act=done]'); await p2.waitForTimeout(300); await clear(p2);
  await p2.keyboard.down('ArrowUp'); await p2.waitForTimeout(300); await p2.keyboard.up('ArrowUp'); await p2.waitForTimeout(150);
  const t = await calls(p2, 'touch_pointer'); assert.ok(t.length >= 3 && t.every(x => x.landscape === true)); await p2.close();
});

await t('FAILURE: control channel not ready → one toast, local state reset, Rust asked to release, recovers afterwards', async () => {
  await page.click(MAP); await page.waitForSelector('#gkPanel.on'); await page.click('[data-act=done]'); await page.waitForTimeout(300); assert.equal(await mode(page), 'play');
  await page.evaluate(() => { window.__failTouch = true; }); await clear(page);
  await page.keyboard.down('Space'); await page.waitForTimeout(150);
  assert.match(await toastText(page), /control channel/); assert.ok((await calls(page, 'touch_release_all')).length >= 1);
  await page.keyboard.up('Space'); await page.evaluate(() => { window.__failTouch = false; }); await clear(page);
  await press(page, 'Space', 120); assert.deepEqual((await calls(page, 'touch_pointer')).map(x => x.phase), ['down', 'up']);
});

await t('Vietnamese UI: labels switch with the app language', async () => {
  await page.evaluate(() => { localStorage.setItem('lumir', JSON.stringify({ lang: 'vi', theme: 'dark' })); window.dispatchEvent(new StorageEvent('storage', { key: 'lumir' })); });
  await page.waitForTimeout(100);
  assert.equal(await page.$eval(MAP, e => e.dataset.tip), 'Ánh xạ phím game'); assert.equal(await page.$eval(KBD, e => e.dataset.tip), 'Bàn phím nhắn tin');
  if (await mode(page) === 'play') await page.click(MAP);   // đang chơi → dừng
  await page.click(MAP); await page.waitForSelector('#gkPanel.on');
  assert.match(await page.$eval('#gkPanel', e => e.textContent), /Joystick tròn[\s\S]*Nút tuỳ chỉnh/); assert.match(await page.$eval('#gkPanel', e => e.textContent), /Lưu[\s\S]*Xong[\s\S]*Huỷ/);
  if (shots) await page.screenshot({ path: shots + '/06-edit-vi.png' });
  await page.click('[data-act=cancel]'); await page.waitForTimeout(300);
});

await t('no console errors during the whole run', async () => { assert.deepEqual(page.__errs.filter(e => !/favicon|VideoDecoder|Failed to load resource/.test(e)), []); });

await browser.close(); srv.close();
console.log(`\n${pass} passed, ${fail} failed`); if (fail) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
