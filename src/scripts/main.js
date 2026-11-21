const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ic = n => `<svg><use href="#i-${n}"/></svg>`;
const VI = { "Android Device Manager": "Trình quản lý thiết bị Android", "All": "Tất cả", "Connected": "Đã kết nối", "Offline": "Ngoại tuyến", "Disconnected": "Chưa kết nối", "Connecting": "Đang kết nối", "Error": "Lỗi", "ADB service ready": "Dịch vụ ADB sẵn sàng", "Filter devices": "Lọc thiết bị", "Settings": "Cài đặt", "More options": "Tùy chọn khác", "Refresh": "Làm mới", "Connect all": "Kết nối tất cả", "Add device": "Thêm thiết bị", "Ready": "Sẵn sàng", "Total devices": "Tổng thiết bị", "Last refresh": "Làm mới lần cuối", "Add LAN device": "Thêm thiết bị LAN", "Device IP address": "Địa chỉ IP thiết bị", "Port": "Cổng", "Device name (optional)": "Tên thiết bị (không bắt buộc)", "Cancel": "Hủy", "Close": "Đóng", "Living room tablet": "Máy tính bảng phòng khách", "General": "Chung", "Theme": "Giao diện", "Dark": "Tối", "Light": "Sáng", "System": "Theo hệ thống", "Language": "Ngôn ngữ", "Startup behavior": "Khi khởi động", "Open main panel": "Mở bảng chính", "Start in tray": "Chạy ẩn trong khay", "Restore last session": "Khôi phục phiên trước", "Minimize to tray": "Thu nhỏ xuống khay", "Connection": "Kết nối", "Default connection mode": "Chế độ kết nối mặc định", "Ask each time": "Hỏi mỗi lần", "Auto refresh": "Tự động làm mới", "Connection timeout": "Thời gian chờ kết nối", "5 seconds": "5 giây", "10 seconds": "10 giây", "30 seconds": "30 giây", "About": "Giới thiệu", "· Version 0.1.0 (prototype)": "· Phiên bản 0.1.0 (bản mẫu)", "Find, connect and manage Android devices over USB and your local network.": "Tìm, kết nối và quản lý thiết bị Android qua USB và mạng nội bộ.", "Done": "Xong", "Disconnect": "Ngắt kết nối", "Retry": "Thử lại", "Connect": "Kết nối", "Show details": "Xem chi tiết", "Resolution": "Độ phân giải", "Device ID": "ID thiết bị", "Status": "Trạng thái", "IP address": "Địa chỉ IP", "USB 3.0 cable": "Cáp USB 3.0", "Needs attention": "Cần kiểm tra", "{0} connected": "{0} đã kết nối", "No matching devices": "Không có thiết bị phù hợp", "Change the filter to see the other {0} devices.": "Đổi bộ lọc để xem các thiết bị {0} khác.", "No USB devices found": "Không tìm thấy thiết bị USB", "Connect your phone with a USB cable and enable USB debugging in Developer options.": "Cắm điện thoại bằng cáp USB và bật Gỡ lỗi USB trong Tùy chọn nhà phát triển.", "Scan again": "Quét lại", "No LAN devices found": "Không tìm thấy thiết bị LAN", "Make sure the phone and this PC are on the same Wi-Fi network, then add the phone by IP address.": "Đảm bảo điện thoại và máy tính cùng mạng Wi-Fi, rồi thêm điện thoại bằng địa chỉ IP.", "Device list refreshed": "Đã làm mới danh sách thiết bị", "Could not reach {0}. Check the network and retry.": "Không kết nối được {0}. Kiểm tra mạng rồi thử lại.", "All devices disconnected": "Đã ngắt kết nối tất cả thiết bị", "Demo data restored": "Đã khôi phục dữ liệu mẫu", "{0} disconnected": "{0} đã ngắt kết nối", "{0} list cleared": "Đã xóa danh sách {0}", "Copied to clipboard": "Đã sao chép", "{0} removed": "Đã xóa {0}", "Enter a valid IP address and port": "Nhập địa chỉ IP và cổng hợp lệ", "Device added": "Đã thêm thiết bị", "Unknown model": "Model không rõ", "Refresh all": "Làm mới tất cả", "Disconnect all": "Ngắt kết nối tất cả", "Restore demo data": "Khôi phục dữ liệu mẫu", "Disconnect all {0}": "Ngắt kết nối tất cả {0}", "Clear list (show empty state)": "Xóa danh sách (xem trạng thái trống)", "Refresh device": "Làm mới thiết bị", "Copy device ID": "Sao chép ID thiết bị", "Copy IP address": "Sao chép địa chỉ IP", "Remove device": "Xóa thiết bị", "Unauthorized": "Chưa cấp quyền", "Open screen": "Mở màn hình", "Device is not connected.": "Thiết bị chưa được kết nối.", "ADB not found": "Không tìm thấy ADB", "ADB timed out": "ADB không phản hồi", "ADB service error": "Lỗi dịch vụ ADB", "Unlock the phone and allow USB debugging.": "Mở khóa điện thoại và cho phép gỡ lỗi USB.", "Device is offline. Unplug the cable and plug it in again.": "Thiết bị đang offline. Rút cáp rồi cắm lại.", "Android 5.0 or newer is required.": "Cần Android 5.0 trở lên.", "Device is already connected.": "Thiết bị đã được kết nối.", "Connection is already in progress.": "Đang kết nối.", "{0} was unplugged or lost": "{0} đã bị rút hoặc mất kết nối", "LAN connection is not available yet": "Chưa hỗ trợ kết nối LAN" };
Object.assign(VI, { 'Connection refused. Turn on Wireless debugging on the phone and check the port.': 'Kết nối bị từ chối. Hãy bật Gỡ lỗi không dây trên điện thoại và kiểm tra lại cổng.', 'Timed out. Check the IP address and that the phone is on the same Wi-Fi.': 'Hết thời gian chờ. Kiểm tra địa chỉ IP và chắc rằng điện thoại cùng mạng Wi-Fi.', 'Enter a valid IP address and port.': 'Nhập địa chỉ IP và cổng hợp lệ.', 'Device is offline. Check the Wi-Fi connection and connect again.': 'Thiết bị đang ngoại tuyến. Kiểm tra Wi-Fi rồi kết nối lại.', 'Found on the network (mDNS)': 'Tìm thấy trong mạng (mDNS)', 'Found {0} device(s) on the network': 'Tìm thấy {0} thiết bị trong mạng', 'No devices found on the network': 'Không tìm thấy thiết bị nào trong mạng', 'Turn on Wireless debugging on the phone (same Wi-Fi as this PC) and it appears here automatically, or add it by IP address. If nothing appears, allow adb.exe through Windows Firewall (private network).': 'Bật Gỡ lỗi không dây trên điện thoại (cùng Wi-Fi với máy tính) thì máy sẽ tự hiện ở đây, hoặc thêm bằng địa chỉ IP. Nếu không thấy gì, hãy cho phép adb.exe qua Tường lửa Windows (mạng riêng tư).', 'No devices found. Turn on Wireless debugging, use the same Wi-Fi, and allow adb.exe in Windows Firewall.': 'Không thấy thiết bị. Hãy bật Gỡ lỗi không dây, dùng cùng Wi-Fi và cho phép adb.exe qua Tường lửa Windows.', 'adb mDNS is not running': 'mDNS của adb không chạy' });
let lang = 'en', theme = 'dark';
const T = (k, ...a) => { let v = lang === 'vi' && VI[k] || k; a.forEach((x, i) => v = v.replace('{' + i + '}', x)); return v };
const lb = x => T(LBL[x]);
const LBL = { connected: 'Connected', disconnected: 'Disconnected', connecting: 'Connecting', error: 'Error', unauthorized: 'Unauthorized' };
const esc = x => String(x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* Backend Rust (Tauri). Ngoài Tauri (mở bằng trình duyệt) vẫn chạy với dữ liệu mẫu. */
const TA = window.__TAURI__, inTauri = !!(TA && TA.core && TA.event);
const call = (c, a) => TA.core.invoke(c, a);
let adbSt = null;
let uid = 10, sel = null, filter = 'all', lastRefresh = new Date();
const seed = () => [
  { id: 1, t: 'usb', name: 'Pixel 8 Pro', model: 'Google GP4BC', av: '14', serial: '1A2B3C4D5E6F', res: '1344×2992', status: 'connected' },
  { id: 2, t: 'usb', name: 'Galaxy S23', model: 'Samsung SM-S911B', av: '14', serial: 'R5CW31ABXYZ', res: '1080×2340', status: 'disconnected' },
  { id: 3, t: 'usb', name: 'Redmi Note 12', model: 'Xiaomi 23021RAA2Y', av: '13', serial: '9f8e7d6c5b4a', res: '1080×2400', status: 'disconnected' },
  { id: 4, t: 'lan', name: 'Living room tablet', model: 'Lenovo Tab P11', av: '12', ip: '192.168.1.42', port: 5555, res: '2000×1200', status: 'connected' },
  { id: 5, t: 'lan', name: 'Test phone 02', model: 'OnePlus 9', av: '13', ip: '192.168.1.57', port: 5555, res: '1080×2400', status: 'disconnected', fail: true },
];
let devs = inTauri ? [] : seed();
const hhmm = d => d.toLocaleTimeString('en-GB');
function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.k); toast.k = setTimeout(() => t.classList.remove('show'), 1800) }
const vis = d => filter === 'all' || (filter === 'connected' ? d.status === 'connected' : d.status !== 'connected');
function empty(t, hidden) {
  const U = t.toUpperCase(), ei = `<div class="ei">${ic(t === 'usb' ? 'usb' : 'net')}</div>`;
  if (hidden) return `<div class="empty">${ei}<h3>${T('No matching devices')}</h3><p>${T('Change the filter to see the other {0} devices.', U)}</p></div>`;
  return t === 'usb'
    ? `<div class="empty">${ei}<h3>${T('No USB devices found')}</h3><p>${T('Connect your phone with a USB cable and enable USB debugging in Developer options.')}</p><button class="btn sm" data-a="refresh">${ic('ref')}${T('Scan again')}</button></div>`
    : `<div class="empty">${ei}<h3>${T('No LAN devices found')}</h3><p>${T('Turn on Wireless debugging on the phone (same Wi-Fi as this PC) and it appears here automatically, or add it by IP address. If nothing appears, allow adb.exe through Windows Firewall (private network).')}</p><button class="btn sm pri" data-a="add">${ic('plus')}${T('Add device')}</button></div>`;
}
function devHTML(d) {
  const sub = d.t === 'usb' ? `${esc(d.model)} · Android ${esc(d.av)}` : `${esc(d.ip)}:${esc(d.port)} · Android ${esc(d.av)}`;
  const on = d.status === 'connected', bz = d.status === 'connecting';
  const kv = d.t === 'usb'
    ? [['Model', esc(d.model)], ['Android', esc(d.av)], ['Resolution', esc(d.res)], ['Device ID', esc(d.serial)], ['Connection', d.speed || (inTauri ? '—' : T('USB 3.0 cable'))], ['Status', lb(d.status)]]
    : [['Model', d.model], ['Android', d.av], ['Resolution', d.res], ['IP address', d.ip], ['Port', d.port], ['Status', lb(d.status)]];
  return `<div class="dev${sel === d.id ? ' sel' : ''}${d.open ? ' open' : ''}" data-id="${esc(d.id)}" data-s="${d.status}">
  <div class="row"><div class="av">${ic('ph')}</div>
   <div class="inf"><div class="nm">${esc(d.name)}<span class="tag">${d.t.toUpperCase()}</span></div><div class="sub">${sub}</div>${d.msg && d.status !== 'connected' ? `<div class="sub msg">${esc(T(d.msg))}</div>` : ''}</div>
   <span class="badge"><i></i>${lb(d.status)}</span>
   <div class="acts">
    ${on && inTauri ? `<button class="btn sm" data-a="phone">${T('Open screen')}</button>` : ''}
    <button class="btn sm${on ? '' : ' pri'}" data-a="${on ? 'disc' : 'conn'}" ${bz ? 'disabled' : ''}>${T(on ? 'Disconnect' : ((d.status === 'error' || d.status === 'unauthorized') ? 'Retry' : 'Connect'))}</button>
    <button class="btn ico sm ghost" data-a="dmore" aria-label="${T('More options')}">${ic('more')}</button>
    <button class="btn ico sm ghost" data-a="exp" aria-label="${T('Show details')}"><span class="chev" style="display:flex">${ic('dn')}</span></button>
   </div></div>
  <div class="more"><div><div class="kv">${kv.map(([k, v]) => `<div><small>${T(k)}</small><span>${v}</span></div>`).join('')}</div></div></div>
 </div>`;
}
function render() {
  ['usb', 'lan'].forEach(t => {
    const p = $(`.panel[data-t=${t}]`), all = devs.filter(d => d.t === t), shown = all.filter(vis);
    $('[data-cnt]', p).textContent = all.length; $(`.tab[data-t=${t}] .tc`).textContent = all.length;
    const c = all.filter(d => d.status === 'connected').length, e = all.some(d => d.status === 'error');
    $('[data-cs]', p).innerHTML = all.length ? `<i class="dot" style="background:${e ? 'var(--err)' : c ? 'var(--ac)' : 'var(--bd)'}"></i>${e ? T('Needs attention') : T('{0} connected', c)}` : '';
    const ca = $('[data-a=all]', p); if (ca) ca.disabled = !all.length || all.every(d => d.status === 'connected');
    $('.list', p).innerHTML = shown.length ? shown.map(devHTML).join('') : empty(t, all.length > 0);
  });
  $('#sT').textContent = devs.length; $('#sC').textContent = devs.filter(d => d.status === 'connected').length; $('#sR').textContent = hhmm(lastRefresh);
}
function connect(d) {
  if (inTauri && d.t === 'lan') {
    if (d.status === 'connecting') return;
    lanTmp.set(d.id, { busy: true }); d.status = 'connecting'; d.msg = null; render();
    call('connect_lan', { host: d.ip, port: d.port }).then(() => toast(T('{0} connected', d.name))).catch(e => { const m = String(e); lanTmp.set(d.id, { msg: m }); d.status = 'error'; d.msg = m; render(); toast(T(m)) });
    return
  }
  if (inTauri && d.t === 'usb') {
    if (d.status === 'connecting') return; d.status = 'connecting'; d.msg = null; render();
    call('connect_device', { serial: d.serial }).then(() => toast(T('{0} connected', d.name))).catch(e => toast(T(String(e))));
    return
  }
  if (d.status === 'connecting') return; d.status = 'connecting'; render();
  setTimeout(() => { if (d.fail) { d.status = 'error'; d.fail = false; toast(T('Could not reach {0}. Check the network and retry.', d.name)) } else { d.status = 'connected'; toast(T('{0} connected', d.name)) } render() }, 1100);
}
function refresh() {
  const b = $$('[data-a=refresh] svg'); b.forEach(s => s.animate({ transform: ['rotate(0)', 'rotate(360deg)'] }, { duration: 600 }));
  if (inTauri) {
    const lanTab = $('.panel[data-t=lan]').classList.contains('act');
    call('list_devices').then(l => { setDevices(l); if (!lanTab) toast(T('Device list refreshed')) }).catch(e => toast(T(String(e))));
    discover(lanTab); return
  }
  setTimeout(() => { lastRefresh = new Date(); render(); toast(T('Device list refreshed')) }, 600);
}
function menu(btn, items) {
  const m = $('#menu'); m.innerHTML = items.map(i => i === '-' ? '<hr>' : `<button class="${i.d ? 'd' : ''}" data-m="${i.k}">${ic(i.i)}${i.l}</button>`).join('');
  const r = btn.getBoundingClientRect(); m.classList.add('show');
  m.style.top = r.bottom + 6 + 'px'; m.style.left = Math.max(8, Math.min(innerWidth - m.offsetWidth - 8, r.right - m.offsetWidth)) + 'px';
  m._h = items;
}
const closeMenu = () => $('#menu').classList.remove('show');
const open = id => $('#' + id).classList.add('show'), shut = () => $$('.ov').forEach(o => o.classList.remove('show'));
document.addEventListener('click', e => {
  const m = e.target.closest('[data-m]');
  if (m) { const k = m.dataset.m; closeMenu(); (menu.cb || (() => { }))(k); return }
  if (!e.target.closest('#menu')) closeMenu();
  if (e.target.closest('[data-close]') || e.target.classList.contains('ov')) { shut(); return }
  const f = e.target.closest('#flt button');
  if (f) { filter = f.dataset.f; $$('#flt button').forEach(b => b.classList.toggle('on', b === f)); render(); return }
  const tb = e.target.closest('.tab'); if (tb) { $$('.tab').forEach(b => b.classList.toggle('on', b === tb)); $$('.panel').forEach(q => q.classList.toggle('act', q.dataset.t === tb.dataset.t)); return }
  const tg = e.target.closest('.tg'); if (tg) { tg.classList.toggle('on'); return }
  if (e.target.closest('#bSet')) { open('ovSet'); return }
  if (e.target.closest('#bMore')) {
    menu.cb = k => { if (k === 'r') refresh(); if (k === 'd') { discAll(devs); render(); toast(T('All devices disconnected')) } if (k === 'x') { devs = seed(); sel = null; render(); toast(T('Demo data restored')) } };
    menu(e.target.closest('#bMore'), [{ k: 'r', i: 'ref', l: T('Refresh all') }, { k: 'd', i: 'off', l: T('Disconnect all') }, ...(inTauri ? [] : ['-', { k: 'x', i: 'ref', l: T('Restore demo data') }])]); return
  }
  const a = e.target.closest('[data-a]'), p = e.target.closest('.panel'), card = e.target.closest('.dev');
  if (a) {
    const k = a.dataset.a, d = card && devs.find(x => String(x.id) === card.dataset.id), t = p && p.dataset.t;
    if (k === 'refresh') refresh();
    else if (k === 'add') { open('ovAdd'); setTimeout(() => $('#aIp').focus(), 50) }
    else if (k === 'all') { devs.filter(x => x.t === t && x.status !== 'connected').forEach(connect) }
    else if (k === 'phone' && d) openPhone(d);
    else if (k === 'conn') connect(d);
    else if (k === 'disc') { discAll([d]); render(); toast(T('{0} disconnected', d.name)) }
    else if (k === 'exp') { d.open = !d.open; render() }
    else if (k === 'smore') {
      menu.cb = c => {
        if (c === 'd') { discAll(devs.filter(x => x.t === t)); render() }
        if (c === 'c') { devs = devs.filter(x => x.t !== t); render(); toast(T('{0} list cleared', t.toUpperCase())) }
      }; menu(a, [{ k: 'd', i: 'off', l: T('Disconnect all {0}', t.toUpperCase()) }, ...(inTauri ? [] : [{ k: 'c', i: 'trash', l: T('Clear list (show empty state)'), d: 1 }])])
    }
    else if (k === 'dmore') {
      menu.cb = c => {
        if (c === 'id') { toast(T('Copied to clipboard')) }
        if (c === 'rm') { if (inTauri) { lanSaved = lanSaved.filter(x => lanId(x.ip, x.port) !== d.id); saveLan(); lanTmp.delete(d.id); call('disconnect_device', { serial: d.serial || d.id }).catch(() => { }) } devs = devs.filter(x => x !== d); if (sel === d.id) sel = null; render(); toast(T('{0} removed', d.name)) }
        if (c === 'rf') { refresh() }
        if (c === 'ph') openPhone(d);
      }; menu(a, [...(inTauri && d.status === 'connected' ? [{ k: 'ph', i: 'ph', l: T('Open screen') }] : []), { k: 'rf', i: 'ref', l: T('Refresh device') }, { k: 'id', i: 'copy', l: T(d.t === 'usb' ? 'Copy device ID' : 'Copy IP address') }, ...(d.t === 'lan' && !d.mdns ? ['-', { k: 'rm', i: 'trash', l: T('Remove device'), d: 1 }] : [])])
    }
    return;
  }
  if (card) {
    const d = devs.find(x => String(x.id) === card.dataset.id); if (d) {
      /* Nhấp đúp (detail===2) mở cửa sổ điện thoại. Xử lý ở đây vì click đầu đã vẽ lại thẻ nên sự kiện dblclick sẽ rơi vào phần tử đã bị gỡ. */
      if (e.detail === 2 && d.status === 'connected') openPhone(d);
      sel = d.id; d.open = true; render()
    }
  }
});
$('#aOk').onclick = () => {
  const ip = $('#aIp'), port = $('#aPort'), ok = /^(\d{1,3}\.){3}\d{1,3}$/.test(ip.value.trim()) && ip.value.split('.').every(n => +n < 256);
  ip.classList.toggle('bad', !ok); const pv = +port.value; port.classList.toggle('bad', !(pv > 0 && pv < 65536));
  if (!ok || !(pv > 0 && pv < 65536)) return toast(T('Enter a valid IP address and port'));
  if (inTauri) {
    const ipv = ip.value.trim(), nm = $('#aName').value.trim(), id = lanId(ipv, pv), s = lanSaved.find(x => lanId(x.ip, x.port) === id);
    if (s) { if (nm) s.name = nm } else lanSaved.push({ ip: ipv, port: pv, name: nm });
    saveLan();['aIp', 'aName'].forEach(i => $('#' + i).value = ''); shut(); setDevices(lastBackend); toast(T('Device added'));
    const d = devs.find(x => x.id === id); if (d && d.status !== 'connected' && d.status !== 'connecting') connect(d);
    return
  }
  devs.push({ id: uid++, t: 'lan', name: $('#aName').value.trim() || 'Android ' + ip.value.split('.').pop(), model: T('Unknown model'), av: '—', ip: ip.value.trim(), port: pv, res: '—', status: 'disconnected' });
  ['aIp', 'aName'].forEach(i => $('#' + i).value = ''); shut(); render(); toast(T('Device added'));
};
document.addEventListener('keydown', e => { if (e.key === 'Escape') { shut(); closeMenu() } if (e.key === 'Enter' && $('#ovAdd').classList.contains('show')) $('#aOk').click() });
const mq = matchMedia('(prefers-color-scheme: dark)'), orig = new Map(), AT = { title: 'oT', 'aria-label': 'oA', placeholder: 'oP' };
const applyTheme = () => { document.documentElement.dataset.theme = (theme === 'light' || (theme === 'system' && !mq.matches)) ? 'light' : 'dark' };
mq.addEventListener('change', applyTheme);
function applyStatic() {
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
  while (n = w.nextNode()) {
    if (n.parentNode.closest('script,.list,#menu,#toast')) continue;
    if (!orig.has(n)) orig.set(n, n.nodeValue);
    const o = orig.get(n), k = o.trim(); if (k && VI[k] !== undefined) n.nodeValue = o.replace(k, T(k));
  }
  $$('[title],[aria-label],[placeholder]').forEach(el => {
    if (el.closest('.list,#menu')) return;
    for (const a in AT) { if (!el.hasAttribute(a)) continue; if (el.dataset[AT[a]] === undefined) el.dataset[AT[a]] = el.getAttribute(a); el.setAttribute(a, T(el.dataset[AT[a]])) }
  });
  document.documentElement.lang = lang; renderAdb();
}
const save = () => { try { localStorage.setItem('lumir', JSON.stringify({ theme, lang })) } catch (_) { } };
try { const v = JSON.parse(localStorage.getItem('lumir') || '{}'); theme = v.theme || theme; lang = v.lang || lang } catch (_) { }
$('#sTheme').selectedIndex = ['dark', 'light', 'system'].indexOf(theme);
$('#sLang').selectedIndex = ['en', 'vi'].indexOf(lang);
$('#sTheme').onchange = e => { theme = ['dark', 'light', 'system'][e.target.selectedIndex]; applyTheme(); save() };
$('#sLang').onchange = e => { lang = ['en', 'vi'][e.target.selectedIndex]; applyStatic(); render(); save() };
applyTheme(); applyStatic();
render();
/* ───── Backend: thiết bị USB thật ───── */
function openPhone(d) {
  if (!inTauri) return;
  call('open_phone_window', { serial: d.serial || d.id }).catch(e => toast(T(String(e))));
}
function discAll(list) {
  list.forEach(d => {
    const was = d.status === 'connected';
    if (inTauri) { lanTmp.delete(d.id); call('disconnect_device', { serial: d.serial || d.id }).catch(() => { }); if (d.t === 'lan' && was) dropLan(d.id) }
    d.status = 'disconnected'; d.msg = null
  });
}
/* Thiết bị Wi-Fi/LAN đã thêm: lưu lại để lần sau còn thấy dù chưa kết nối. Khoá = "ip:cổng" (cũng là serial adb). */
const LANK = 'lumir-lan', lanId = (ip, port) => ip + ':' + port;
let lanSaved = [], lastBackend = [], lanFound = [], discBusy = false, discKey = '';
try { lanSaved = JSON.parse(localStorage.getItem(LANK) || '[]').filter(x => x && typeof x.ip === 'string' && x.port > 0) } catch (_) { }
const saveLan = () => { try { localStorage.setItem(LANK, JSON.stringify(lanSaved)) } catch (_) { } };
/* Thiết bị LAN ngắt kết nối hoàn toàn thì tự xoá khỏi danh sách (và danh sách đã lưu). Máy còn bật Gỡ lỗi không dây sẽ hiện lại ở mục tìm thấy bằng mDNS. */
function dropLan(id) { lanSaved = lanSaved.filter(x => lanId(x.ip, x.port) !== id); saveLan(); lanTmp.delete(id); devs = devs.filter(x => !(x.t === 'lan' && x.id === id)) }
const lanTmp = new Map();   /* id → {busy}|{msg}: trạng thái "đang kết nối / lỗi" khi adb chưa liệt kê máy */
const fromBackend = v => {
  const lan = v.kind === 'lan', i = lan ? v.serial.lastIndexOf(':') : -1;
  return {
    id: v.id, t: lan ? 'lan' : 'usb', name: v.name, model: v.model, av: v.android || '—', serial: v.serial, res: v.resolution || '—', speed: v.usbSpeed, status: v.status, msg: v.message,
    ...(lan ? { ip: v.serial.slice(0, i), port: +v.serial.slice(i + 1) } : {})
  };
};
function setDevices(list) {
  lastBackend = list;
  /* Máy LAN đang kết nối mà mất kết nối (tắt Wi-Fi, tắt Gỡ lỗi không dây...): xoá luôn và gỡ khỏi danh sách adb để không còn hiện "offline". */
  devs.filter(d => d.t === 'lan' && d.status === 'connected' && !list.some(v => v.id === d.id && v.status === 'connected')).forEach(d => {
    dropLan(d.id); call('disconnect_device', { serial: d.serial || d.id }).catch(() => { })
  });
  const open = new Map(devs.map(d => [d.id, d.open]));
  const back = list.map(v => { const n = fromBackend(v); n.open = !!open.get(n.id); return n });
  const seen = new Set(back.map(d => d.id));
  back.forEach(d => { if (d.t === 'lan') { lanTmp.delete(d.id); const s = lanSaved.find(x => lanId(x.ip, x.port) === d.id); if (s && s.name) d.name = s.name } });
  const mk = (x, extra) => {
    const id = lanId(x.ip, x.port), e = lanTmp.get(id);
    return {
      id, t: 'lan', name: x.name || 'Android ' + x.ip.split('.').pop(), model: T('Unknown model'), av: '—', ip: x.ip, port: x.port, res: '—', serial: id,
      status: e ? (e.busy ? 'connecting' : 'error') : 'disconnected', msg: (e && e.msg) || (extra && extra.msg) || null, open: !!open.get(id), ...(extra || {})
    }
  };
  const local = lanSaved.filter(x => !seen.has(lanId(x.ip, x.port))).map(x => { seen.add(lanId(x.ip, x.port)); return mk(x) });
  /* Máy tìm thấy bằng mDNS (đang bật Gỡ lỗi không dây) nhưng chưa kết nối: hiện sẵn để bấm Connect. Máy đang chờ ghép nối bằng mã thì bỏ qua. */
  const found = lanFound.filter(x => !x.pairing && !seen.has(lanId(x.host, x.port))).map(x => { seen.add(lanId(x.host, x.port)); return mk({ ip: x.host, port: x.port, name: x.name }, { mdns: true, msg: 'Found on the network (mDNS)' }) });
  devs = [...back, ...local, ...found];
  if (sel !== null && !devs.some(d => d.id === sel)) sel = null;
  lastRefresh = new Date(); render();
}
function renderAdb() {
  const el = $('#adbSys'); if (!el || !adbSt) return;
  const ok = adbSt.ready, txt = ok ? 'ADB service ready' : (adbSt.errorCode === 'not_found' ? 'ADB not found' : 'ADB service error');
  $('#adbTxt').textContent = T(txt);
  $('.dot', el).style.background = ok ? '' : 'var(--err)';
  el.title = 'ADB executable: ' + (adbSt.path || '(unresolved)') + (adbSt.version ? '\n' + adbSt.version : '') + (adbSt.error ? '\n' + adbSt.error : '');
}
/* Quét mDNS: tự chạy nền (im lặng); bấm làm mới ở tab LAN thì báo kết quả. */
function discover(manual) {
  if (!inTauri || discBusy) return; discBusy = true;
  call('discover_lan').then(l => {
    const k = JSON.stringify(l); if (k !== discKey) { discKey = k; lanFound = l; setDevices(lastBackend) }
    if (manual) { const n = l.filter(x => !x.pairing).length; toast(n ? T('Found {0} device(s) on the network', n) : T('No devices found. Turn on Wireless debugging, use the same Wi-Fi, and allow adb.exe in Windows Firewall.')) }
  }).catch(e => { if (manual) toast(T(String(e))) }).finally(() => { discBusy = false });
}
async function initBackend() {
  const L = TA.event.listen;
  await L('devices-changed', e => setDevices(e.payload));
  await L('adb-status', e => { adbSt = e.payload; renderAdb() });
  await L('device-lost', e => toast(T('{0} was unplugged or lost', e.payload)));
  call('adb_status').then(s => { adbSt = s; renderAdb() }).catch(() => { });
  call('list_devices').then(setDevices).catch(() => { });
  discover(); setInterval(discover, 6000);
}
if (inTauri) initBackend();