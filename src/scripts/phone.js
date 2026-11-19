/* Cửa sổ điện thoại nổi: khung màn hình + thanh điều hướng dọc bên phải.
   - Nút Back/Home/Recents/âm lượng/nguồn gửi phím thật tới điện thoại (adb input keyevent).
   - Vùng hình đang là khung chờ; video stream sẽ gắn vào #phone ở giai đoạn sau.
   - Ngoài Tauri (mở bằng trình duyệt) chạy chế độ demo để xem bố cục. */
(()=>{
'use strict';
const TA=window.__TAURI__,demo=!(TA&&TA.core&&TA.window);
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const call=demo?async()=>null:(c,a)=>TA.core.invoke(c,a);
const win=demo?null:TA.window.getCurrentWindow();

const VI={
 'Back':'Quay lại','Home':'Màn hình chính','Recent apps':'Ứng dụng gần đây',
 'Volume up':'Tăng âm lượng','Volume down':'Giảm âm lượng','Power / screen':'Nguồn / màn hình',
 'Always on top':'Luôn nổi trên cùng','Key mapping (coming soon)':'Ánh xạ phím (sắp có)',
 'Main window':'Cửa sổ chính','Minimize':'Thu nhỏ','Close':'Đóng',
 'Waiting for video stream':'Đang chờ luồng video',
 'Video streaming arrives in the next update.':'Truyền hình ảnh sẽ có ở bản cập nhật tiếp theo.',
 'Device disconnected':'Thiết bị đã ngắt kết nối',
 'Plug the cable back in and connect from the main window.':'Cắm lại cáp rồi kết nối từ cửa sổ chính.',
 'Open main window':'Mở cửa sổ chính',
 'Device is not connected.':'Thiết bị chưa được kết nối.',
 'ADB timed out':'ADB không phản hồi','ADB not found':'Không tìm thấy ADB'
};
let lang='en',theme='dark',pinned=true,serial='',dev=null,connected=false,ar=9/20;
const T=k=>lang==='vi'&&VI[k]||k;
const mq=matchMedia('(prefers-color-scheme: dark)');

/* ── Icon (viewBox 24, nét 1.8 — cùng phong cách cửa sổ chính) ── */
const P={
 back:'<path d="M15.5 5.5v13L7 12z"/>',
 home:'<circle cx="12" cy="12" r="6"/>',
 recents:'<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
 volup:'<path d="M4 10v4h3l4 3V7l-4 3z"/><path d="M15 9.5a3.5 3.5 0 010 5"/><path d="M17.8 7a7 7 0 010 10"/>',
 voldn:'<path d="M4 10v4h3l4 3V7l-4 3z"/><path d="M15 9.5a3.5 3.5 0 010 5"/>',
 power:'<path d="M12 3.5v8"/><path d="M7.4 6.6a7 7 0 109.2 0"/>',
 pin:'<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>',
 keys:'<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
 main:'<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9.5h17"/>',
 min:'<path d="M6 12h12"/>',
 x:'<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'
};
const svg=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;

/* Thứ tự thanh dọc: điều hướng → phần cứng → công cụ → (đệm) → về cửa sổ chính */
const RAIL=[
 {t:'key',k:'back',i:'back',l:'Back'},
 {t:'key',k:'home',i:'home',l:'Home'},
 {t:'key',k:'recents',i:'recents',l:'Recent apps'},
 {t:'sep'},
 {t:'key',k:'volume_up',i:'volup',l:'Volume up'},
 {t:'key',k:'volume_down',i:'voldn',l:'Volume down'},
 {t:'key',k:'power',i:'power',l:'Power / screen'},
 {t:'sep'},
 {t:'pin',i:'pin',l:'Always on top'},
 {t:'map',i:'keys',l:'Key mapping (coming soon)'},
 {t:'sp'},
 {t:'main',i:'main',l:'Main window'}
];

function buildRail(){
 $('#rail').innerHTML=RAIL.map(r=>{
  if(r.t==='sep')return'<div class="rsep"></div>';
  if(r.t==='sp')return'<div class="rsp"></div>';
  return`<button class="rb" data-t="${r.t}" ${r.k?`data-k="${r.k}"`:''} data-l="${r.l}">${svg(r.i)}</button>`;
 }).join('');
 $('#bMin').innerHTML=svg('min');$('#bClose').innerHTML=svg('x');
}

/* ── Ngôn ngữ / giao diện: dùng chung cài đặt với cửa sổ chính ── */
function loadPrefs(){try{const v=JSON.parse(localStorage.getItem('lumir')||'{}');theme=v.theme||'dark';lang=v.lang||'en'}catch(_){}
 try{pinned=localStorage.getItem('lumir-pin')!=='0'}catch(_){}}
function applyTheme(){document.documentElement.dataset.theme=(theme==='light'||(theme==='system'&&!mq.matches))?'light':'dark'}
function applyLang(){
 document.documentElement.lang=lang;
 $$('[data-t]:not(.rb)').forEach(e=>{if(e.dataset.o===undefined)e.dataset.o=e.textContent;e.textContent=T(e.dataset.o)});
 $$('[data-l]').forEach(e=>{const s=T(e.dataset.l);e.setAttribute('aria-label',s);e.dataset.tip=s;if(e.classList.contains('ib'))e.title=s});
}

/* ── Trạng thái thiết bị ── */
function parseRes(r){const m=/(\d+)\s*[×x]\s*(\d+)/.exec(r||'');return m&&+m[1]>0&&+m[2]>0?+m[1]/+m[2]:null}
function setDevice(d){
 if(d)dev={...(dev||{}),...d};
 connected=!!d&&d.status==='connected';
 const name=(dev&&dev.name)||'—';
 $('#phNm').textContent=name;
 $('#phRes').textContent=(dev&&dev.resolution)||'—';
 $('#ttl').textContent='LUMIR · '+name;
 document.title='LUMIR — '+name;
 $('#top').classList.toggle('off',!connected);
 $('#ovl').hidden=connected;
 $$('.rb[data-t=key]').forEach(b=>b.disabled=!connected);
 const a=parseRes(dev&&dev.resolution);if(a)ar=a;
 fit();
}
/* Khung điện thoại vừa khít vùng stage, giữ đúng tỉ lệ màn hình */
function fit(){
 const st=$('#stage'),r=st.getBoundingClientRect(),cs=getComputedStyle(st);
 const aw=r.width-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight),ah=r.height-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
 let w=ah*ar,h=ah;if(w>aw){w=aw;h=aw/ar}
 w=Math.max(0,Math.floor(w));h=Math.max(0,Math.floor(h));
 const p=$('#phone');p.style.width=w+'px';p.style.height=h+'px';p.style.borderRadius=Math.round(Math.min(w,h)*.09)+'px';
}

/* ── Hành động ── */
let tt;function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('show'),2200)}
const busy=new Set();
async function press(btn){
 const k=btn.dataset.k;if(!connected||busy.has(k))return;
 busy.add(k);btn.classList.add('flash');setTimeout(()=>btn.classList.remove('flash'),160);
 try{await call('send_key',{serial,key:k})}catch(e){toast(T(String(e)))}finally{busy.delete(k)}
}
function setPin(on,persist){
 pinned=on;const b=$('.rb[data-t=pin]');b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);
 call('set_always_on_top',{on}).catch(()=>{});
 if(persist)try{localStorage.setItem('lumir-pin',on?'1':'0')}catch(_){}
}
const toMain=()=>call('focus_main_window').catch(e=>toast(T(String(e))));

document.addEventListener('click',e=>{
 const b=e.target.closest('.rb');
 if(b){
  const t=b.dataset.t;
  if(t==='key')press(b);
  else if(t==='pin')setPin(!pinned,true);
  else if(t==='main')toMain();
  else if(t==='map')toast(T('Key mapping (coming soon)'));
  return}
 if(e.target.closest('#bOvlMain'))toMain();
 else if(e.target.closest('#bMin')&&win)win.minimize();
 else if(e.target.closest('#bClose')){win?win.close():window.close()}
});
$('#top').addEventListener('mousedown',e=>{if(e.button!==0||e.target.closest('button')||!win)return;win.startDragging().catch(()=>{})});
document.addEventListener('contextmenu',e=>e.preventDefault());
new ResizeObserver(fit).observe($('#stage'));
mq.addEventListener('change',applyTheme);
/* Đổi ngôn ngữ / giao diện ở cửa sổ chính → cập nhật ngay ở đây */
window.addEventListener('storage',e=>{if(e.key==='lumir'){loadPrefs();applyTheme();applyLang()}});

async function init(){
 loadPrefs();applyTheme();buildRail();applyLang();
 if(demo){serial='DEMO';setDevice({name:'Demo phone',resolution:'1080×2400',status:'connected'});setPin(pinned,false);return}
 try{const c=await call('phone_context');serial=c.serial;setDevice(c.device||{status:'disconnected'})}
 catch(e){setDevice({status:'disconnected'})}
 await TA.event.listen('devices-changed',ev=>{const d=ev.payload.find(x=>x.serial===serial);setDevice(d||{status:'disconnected'})});
 setPin(pinned,false);
}
init();
})();
